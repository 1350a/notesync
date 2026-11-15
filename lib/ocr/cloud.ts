/*
 * 云端 OCR 客户端（服务端侧）：智谱 glm-ocr 专用模型
 *
 * 协议见 doc/cloud-ocr.md §2/§5：glm-ocr 不走 chat/completions，走独立
 * layout_parsing 端点，file 直收 base64（去 dataUrl 前缀）。密钥复用
 * ZHIPU_API_KEY，不出服务端（AGENTS.md §7）。解析与校验保持纯函数，
 * 供 vitest 零依赖直测；网络函数仅 app/api/ocr/route.ts 调用。
 */
import { extractUpstreamMessage, redactUpstreamText } from "../safety/redact.ts";

/** 专用 OCR 模型名：layout_parsing 端点当前仅支持该模型（doc/cloud-ocr.md §2） */
const ZHIPU_OCR_MODEL = "glm-ocr";

/**
 * 单图请求超时（ms）：10MB 大图解析可达数秒，取 60s——与 chat 链路的 120s 分开，
 * 转写失败尽快暴露给阻断式失败语义（doc/cloud-ocr.md §6）。
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** glm-ocr 单图上限 10MB（解码后字节） */
export const CLOUD_OCR_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * dataUrl 前缀校验：glm-ocr 仅收 JPG/PNG。app 的 detect 层放行 webp/bmp，
 * 云端引擎下在此收窄为显式失败（不静默转格式、不静默回落，doc/cloud-ocr.md §6）。
 */
const DATA_URL_RE = /^data:image\/(png|jpe?g);base64,(.+)$/;

export interface ParsedImageDataUrl {
  mime: "image/png" | "image/jpeg";
  base64: string;
}

/** 纯函数：校验并拆出 base64 载荷；不合法返回 null（调用方映射 invalid_request） */
export function parseImageDataUrl(dataUrl: unknown): ParsedImageDataUrl | null {
  if (typeof dataUrl !== "string") return null;
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;
  return { mime: match[1] === "png" ? "image/png" : "image/jpeg", base64: match[2] };
}

/** base64 解码后字节数（按 padding 精确化）：请求前做大小门禁，避免整图白传 */
export function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** 转写失败错误：code 与 /api/ocr 错误码表（doc/cloud-ocr.md §5）对齐 */
export class CloudOcrError extends Error {
  readonly code: "parse_error" | "provider_error";

  constructor(code: "parse_error" | "provider_error", message: string) {
    super(message);
    this.name = "CloudOcrError";
    this.code = code;
  }
}

export interface CloudOcrResult {
  /** md_results 全文（Markdown；可能为空串——空由调用方按失败处理，与本地引擎同口径） */
  text: string;
  /** 逐块布局（label/bbox/content），本轮透传不消费，供启发式/相关性判断挂账用 */
  layoutDetails?: unknown;
}

/** 纯函数：解析 layout_parsing 成功响应；结构不符抛 parse_error */
export function parseLayoutParsingResponse(payload: unknown): CloudOcrResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CloudOcrError("parse_error", "智谱 OCR 响应结构不符（缺少对象体）");
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.md_results !== "string") {
    throw new CloudOcrError("parse_error", "智谱 OCR 响应缺少 md_results 字段");
  }
  return {
    text: record.md_results.trim(),
    layoutDetails: record.layout_details,
  };
}

export function cloudOcrAvailable(): boolean {
  return Boolean(process.env.ZHIPU_API_KEY);
}

/**
 * 调 glm-ocr 转写一张图。上游/网络/解析失败一律抛 CloudOcrError。
 * 入参用 parseImageDataUrl 的产物：mime 在拼 dataUrl 前缀时要原样带回（见下方 file 说明）。
 */
export async function cloudOcrRecognize(image: ParsedImageDataUrl): Promise<CloudOcrResult> {
  const apiKey = process.env.ZHIPU_API_KEY || "";
  const baseUrl = process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
  // 路由层已做 unconfigured 门禁，此处兜底防直接调用（如冒烟脚本）绕过校验
  if (!apiKey) throw new CloudOcrError("provider_error", "ZHIPU_API_KEY 未配置");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/layout_parsing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // file 必须是带前缀的 dataUrl：上游把裸 base64 当作无扩展名的文件路径，
      // 直接 400「仅支持PDF、JPG、PNG、JPEG格式」；带前缀实测 200（2026-11-13 冒烟，doc/cloud-ocr.md §8）
      body: JSON.stringify({
        model: ZHIPU_OCR_MODEL,
        file: `data:${image.mime};base64,${image.base64}`,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CloudOcrError("provider_error", `无法连接智谱 OCR 端点：${reason}`);
  }

  // 先取文本再尝试解析：上游错误可能是非 JSON（网关 HTML/纯文本），语义不能丢
  const raw = await res.text();
  if (!res.ok) {
    // 与 chat 链路同口径：只取 message 语义并脱敏，不贴整段响应（lib/safety/redact.ts）
    const summary = redactUpstreamText(extractUpstreamMessage(raw));
    throw new CloudOcrError(
      "provider_error",
      `智谱 OCR 上游错误（HTTP ${res.status}）${summary ? `：${summary}` : ""}`,
    );
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  return parseLayoutParsingResponse(payload);
}
