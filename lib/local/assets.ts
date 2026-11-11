/*
 * 浏览器端本地推理资产探测
 *
 * 协议见 doc/browser-local-inference.md §3：
 * - 模型与 ORT wasm 全部自托管于 public/models/（npm run local:assets 派生）；
 * - 资产缺失属可检测的未就绪状态，调用方据此标记能力不可用，不允许假可用。
 */
export interface LocalAssetStatus {
  ready: boolean;
  /** 未就绪的资产路径，用于页面提示修复方式 */
  missing: string[];
}

const MODEL_BASE = "/models/bge-small-zh-v1.5";

/** 与 scripts/copy-local-models.mjs 的产出一一对应（两档权重 + 配套 + ORT wasm） */
const ASSET_URLS = [
  `${MODEL_BASE}/config.json`,
  `${MODEL_BASE}/tokenizer.json`,
  `${MODEL_BASE}/tokenizer_config.json`,
  `${MODEL_BASE}/onnx/model_quantized.onnx`,
  `${MODEL_BASE}/onnx/model_quantized.onnx_data`,
  `${MODEL_BASE}/onnx/model_q4f16.onnx`,
  `${MODEL_BASE}/onnx/model_q4f16.onnx_data`,
  "/models/ort/ort-wasm-simd-threaded.wasm",
  "/models/ort/ort-wasm-simd-threaded.mjs",
  "/models/ort/ort-wasm-simd-threaded.jsep.wasm",
  "/models/ort/ort-wasm-simd-threaded.jsep.mjs",
  // 非跨源隔离（缺 COOP/COEP，无 SharedArrayBuffer）时 ORT 单线程实际加载 asyncify 档，
  // 缺失该档会在实例化阶段报 Failed to fetch dynamically imported module
  "/models/ort/ort-wasm-simd-threaded.asyncify.wasm",
  "/models/ort/ort-wasm-simd-threaded.asyncify.mjs",
];

/**
 * 探测全部运行时资产是否就位。
 * HEAD + no-store：资产为派生产物，可能随时被清理，不做任何缓存假设（对齐 checkOcrAssets）。
 */
export async function checkLocalAssets(): Promise<LocalAssetStatus> {
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
