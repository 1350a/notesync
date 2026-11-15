/*
 * 浏览器端本地 OCR 服务（tesseract.js v7）
 *
 * 协议见 doc/browser-local-ocr.md：
 * - 推理完全在浏览器 Worker 内进行，图片与识别文本不经服务器；
 * - 运行时资产（worker/core/语言包）全部自托管于 public/ocr/，零 CDN 外联；
 * - 引擎不可用时必须以"未就绪"暴露给调用方，不允许假可用。
 */
import type { LoggerMessage, Worker as TesseractWorker } from "tesseract.js";

/** 语言包：v7 在自定义 langPath 下多语言加载乱码（服务端时代已踩坑），固定单语言 */
const OCR_LANG = "chi_sim";
/** LSTM 引擎（oem=1）：tesseract 4+ 默认识别模式，legacy 引擎对中文无增益 */
const OCR_OEM = 1;

const OCR_BASE = "/ocr";
const WORKER_PATH = `${OCR_BASE}/worker/worker.min.js`;
const CORE_PATH = `${OCR_BASE}/core`;
const LANG_PATH = `${OCR_BASE}/tessdata`;

/** core 变体与语言包：与 scripts/copy-ocr-assets.mjs 的产出一一对应 */
const ASSET_URLS = [
  WORKER_PATH,
  "tesseract-core.wasm.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
].map((name) => (name.startsWith("/") ? name : `${CORE_PATH}/${name}`))
  .concat([`${LANG_PATH}/${OCR_LANG}.traineddata.gz`]);

export interface OcrAssetStatus {
  ready: boolean;
  /** 未就绪的资产路径，用于页面提示修复方式 */
  missing: string[];
}

/**
 * 探测全部运行时资产是否就位。
 * HEAD + no-store：资产由 npm run ocr:assets 派生，可能随时被清理，不做任何缓存假设。
 */
export async function checkOcrAssets(): Promise<OcrAssetStatus> {
  const missing: string[] = [];
  await Promise.all(
    ASSET_URLS.map(async (url) => {
      try {
        const res = await fetch(url, { method: "HEAD", cache: "no-store" });
        if (!res.ok) missing.push(url);
      } catch {
        missing.push(url);
      }
    }),
  );
  return { ready: missing.length === 0, missing };
}

export interface OcrProgress {
  /** 引擎阶段名（loading tesseract core / initializing api / recognizing text 等） */
  status: string;
  /** 0~1，引擎初始化阶段可能为 -1（无进度含义） */
  progress: number;
}

export type OcrProgressListener = (progress: OcrProgress) => void;

export interface OcrResult {
  /** 识别原文（仅去除首尾空白，未做规范化） */
  text: string;
  /** 整体置信度 0~100 */
  confidence: number;
  /** 纯识别耗时（不含 worker 初始化），毫秒 */
  elapsedMs: number;
}

let workerPromise: Promise<TesseractWorker> | null = null;
// 单 worker 串行处理，因此进度监听用模块级单槽：当前场景（能力页自检/低频识别）
// 不会并发调用 recognize，不值得为此引入任务队列。
let progressListener: OcrProgressListener | null = null;

function onLoggerMessage(m: LoggerMessage): void {
  progressListener?.({ status: m.status, progress: m.progress });
}

/** 惰性创建 worker；失败后清空单例，允许下次调用重试 */
function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js")
      .then(({ createWorker }) =>
        createWorker(OCR_LANG, OCR_OEM, {
          // 自托管路径：worker 经 importScripts 加载（同源），core 由引擎按 SIMD 特性自选
          workerPath: WORKER_PATH,
          corePath: CORE_PATH,
          langPath: LANG_PATH,
          // 语言包以 .traineddata.gz 分发，gzip 默认开启，保持默认即可
          logger: onLoggerMessage,
        }),
      )
      .catch((err) => {
        workerPromise = null;
        throw err;
      });
  }
  return workerPromise;
}

/**
 * 对图片做本地 OCR。
 * @param source 图片 Blob/File，或 dataURL 字符串
 * @param onProgress 可选进度回调（含首次初始化阶段）
 */
export async function ocrRecognize(
  source: Blob | string,
  onProgress?: OcrProgressListener,
): Promise<OcrResult> {
  if (typeof window === "undefined") {
    throw new Error("本地 OCR 仅能在浏览器环境运行");
  }
  const worker = await getWorker();
  progressListener = onProgress ?? null;
  const started = performance.now();
  try {
    const { data } = await worker.recognize(source);
    return {
      text: (data.text ?? "").trim(),
      confidence: data.confidence ?? 0,
      elapsedMs: Math.round(performance.now() - started),
    };
  } finally {
    progressListener = null;
  }
}

/** 终止并释放 worker（页面卸载或显式释放内存时调用） */
export async function disposeOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  await worker?.terminate();
}

/** 比对/展示用规范化：去空白、全角转半角、小写化 */
export function normalizeOcrText(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[\uFF01-\uFF5E]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .toLowerCase();
}
