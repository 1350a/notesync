/*
 * 图片发送管线：模式推导 + OCR 转文字。
 *
 * 协议见 doc/browser-local-ocr.md §6：纯文本模型路径的图片先转成文字再发送
 * （多模态模型直传原图、无转写，product-vision.md P4 自动路由，2026-11-14）。
 * 本模块同时被客户端组件与服务端（lib/chat/messages.ts 的 OCR 文本块格式化）引用，
 * 除 ocrRecognize 外保持纯函数。
 */
import { ocrRecognize } from "./local.ts";
import { CLIENT_ID_HEADER, getClientId } from "../client-id.ts";
import type { OcrEngine } from "../settings/types.ts";

/**
 * 图片发送模式：原图直传 | OCR 转文字。
 * 命名注意：ocr-text 不代表本地引擎——转写引擎由设置 ocr.engine 决定（默认云端），
 * "local-ocr" 旧名在云端引擎下成了谎言，2026-11-14 更名（doc/browser-local-ocr.md §6.1）。
 */
export type ImageSendMode = "direct" | "ocr-text";

/** 模型图片能力来源：/api/models 透传的 acceptsImages（undefined=能力未知） */
export interface ImageCapability {
  acceptsImages?: boolean;
}

/**
 * 推导图片发送模式（2026-11-14 起只看模型能力，无人工档位，product-vision.md P4）：
 * 1. acceptsImages === true → direct：多模态直传原图，无转写；
 * 2. false / undefined / 无模型 → ocr-text（能力未知保守转文字，绝不赌上游）。
 * 旧 preferLocal 偏好与 mixed 混合档已删（服务端组装仅为旧历史重发保留兼容）。
 */
export function resolveImageSendMode(model: ImageCapability | undefined): ImageSendMode {
  return model?.acceptsImages === true ? "direct" : "ocr-text";
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
