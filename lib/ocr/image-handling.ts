/*
 * 图片发送管线：模式推导 + 本地 OCR 转文字。
 *
 * 协议见 doc/browser-local-ocr.md §6：聊天/诊断的图片先在浏览器内转成文字再发送，
 * 纯文本模型因此能消费图片内容而不报错。本模块同时被客户端组件与服务端
 * （lib/chat/messages.ts 的 OCR 文本块格式化）引用，除 ocrRecognize 外保持纯函数。
 */
import { ocrRecognize } from "./local.ts";
import { CLIENT_ID_HEADER, getClientId } from "../client-id.ts";
import type { OcrEngine } from "../settings/types.ts";

/** 图片发送模式：原图直传 | 本地 OCR 转文字（全本地） | 混合（OCR 打底 + 原图补充） */
export type ImageSendMode = "direct" | "local-ocr" | "mixed";

/** 模型图片能力来源：/api/models 透传的 acceptsImages（undefined=能力未知） */
export interface ImageCapability {
  acceptsImages?: boolean;
}

/**
 * 推导图片发送模式（优先级见 doc/browser-local-ocr.md §6.1）：
 * 1. 用户显式偏好 preferLocal（设置页"优先本地OCR"）→ 一律转文字，隐私优先；
 * 2. 能力未知 → 保守转文字（绝不赌上游能不能吃 image_url）；
 * 3. 其余按模型声明能力。
 */
export function resolveImageSendMode(
  model: ImageCapability | undefined,
  preferLocal: boolean,
): ImageSendMode {
  if (preferLocal) return "local-ocr";
  if (!model || model.acceptsImages === undefined) return "local-ocr";
  return model.acceptsImages ? "direct" : "local-ocr";
}

/** OCR 文本块格式：服务端拼消息与诊断附件写入共用，改格式须同步 doc §6.2 */
export function formatOcrBlock(text: string): string {
  return `【图片OCR】\n${text.trim()}\n【/图片OCR】`;
}

/** 已有文本与 OCR 文本合并（诊断附件 text 字段复用） */
export function mergeOcrText(existing: string | undefined, ocrText: string): string {
  return [existing?.trim(), formatOcrBlock(ocrText)].filter(Boolean).join("\n\n");
}

export interface ImageOcrFailure {
  /** 对应入参 images 的下标（0 起） */
  index: number;
  reason: string;
}

export interface ImageConversionResult {
  /** 与入参 images 一一对应；失败项为 null（调用方必须显式处理，不得静默丢弃） */
  texts: (string | null)[];
  /**
   * 与 texts 一一对应的整体置信度（0~100，tesseract 口径）；失败项为 null。
   * 云端引擎无 tesseract 置信度，恒为 null（低置信标红规则仅适用本地引擎，
   * doc/cloud-ocr.md §6）。供回显确认面板标注低置信项（diagnosis-model.md §1.3 规则②）
   */
  confidences: (number | null)[];
  failures: ImageOcrFailure[];
  elapsedMs: number;
}

/**
 * 单张识别：local=tesseract（浏览器 Worker 内）；cloud=POST /api/ocr（服务端代理 glm-ocr，
 * 像素出端——开启即用户显式同意，doc/cloud-ocr.md §3）。失败语义同 §6：抛错交调用方
 * 阻断/提示，绝不静默回落另一引擎。
 */
async function recognizeOne(
  dataUrl: string,
  engine: OcrEngine,
): Promise<{ text: string; confidence: number | null }> {
  if (engine === "cloud") {
    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json", [CLIENT_ID_HEADER]: getClientId() },
      body: JSON.stringify({ image: dataUrl }),
    });
    const payload: unknown = await res.json().catch(() => null);
    const record =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    if (!res.ok) {
      const message =
        typeof record?.message === "string" && record.message.trim()
          ? record.message.trim()
          : `请求失败（HTTP ${res.status}）`;
      throw new Error(message);
    }
    // 成功响应的 text 可能为空串：空结果由上层按失败统一处理（与本地引擎同口径）
    return { text: typeof record?.text === "string" ? record.text : "", confidence: null };
  }
  const { text, confidence } = await ocrRecognize(dataUrl);
  return { text, confidence };
}

/**
 * 把一组图片 dataUrl 依次转文字（engine 决定本地 tesseract 或云端 glm-ocr，
 * doc/cloud-ocr.md §6）。失败（异常或空结果）逐张记录为 failure，由调用方阻断发送
 * 并交用户决策——静默丢内容违反 doc §6.4 的失败语义。
 */
export async function convertImagesToTexts(
  images: string[],
  onProgress?: (done: number, total: number) => void,
  engine: OcrEngine = "local",
): Promise<ImageConversionResult> {
  const started = performance.now();
  const texts: (string | null)[] = new Array(images.length).fill(null);
  const confidences: (number | null)[] = new Array(images.length).fill(null);
  const failures: ImageOcrFailure[] = [];
  let done = 0;

  for (let i = 0; i < images.length; i += 1) {
    try {
      const { text, confidence } = await recognizeOne(images[i], engine);
      // 空结果按失败处理：图片无字与识别崩溃对用户而言都需要显式决策
      if (text.trim()) {
        texts[i] = text;
        confidences[i] = confidence;
      } else {
        failures.push({ index: i, reason: "未识别到文字（图片中可能没有文本）" });
      }
    } catch (err) {
      failures.push({
        index: i,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    done += 1;
    onProgress?.(done, images.length);
  }

  return { texts, confidences, failures, elapsedMs: Math.round(performance.now() - started) };
}
