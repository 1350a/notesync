/*
 * 本地推理 Web Worker（模块级，由 lib/local/engine.ts 经 new Worker 挂载）
 *
 * 协议见 doc/browser-local-inference.md §2/§4：
 * - 推理全部在本 Worker 内进行，语料与查询向量不回主线程以外的任何地方；
 * - 设备探测：WebGPU（需 shader-f16，q4f16 档依赖）失败静默回退 WASM（q8 档）——
 *   后端切换不改变数据边界（均在设备内），静默合法；
 * - dtype 显式按设备传单值，不使用官方未文档化的 per-device 映射写法。
 */
import { env, pipeline } from "@huggingface/transformers";

// 浏览器下 allowLocalModels 默认 false（v4 官方文档核实），必须显式开启，
// 否则永远尝试远程加载；allowRemoteModels=false 保证零外联。
env.allowLocalModels = true;
env.allowRemoteModels = false;
// localModelPath 浏览器默认即 /models/，显式声明以固定布局契约
env.localModelPath = "/models/";
// ORT wasm 自托管路径（useWasmCache 默认 true，wasm 亦进 Cache API，离线可复用）。
// 配置失败必须响亮报错：wasmPaths 缺省时 ORT 会回退 jsdelivr CDN，违反零外联契约。
const wasmEnv = env.backends.onnx.wasm;
if (!wasmEnv) {
  throw new Error("ORT wasm 环境未挂载，无法配置自托管路径");
}
wasmEnv.wasmPaths = "/models/ort/";

const MODEL_PATH = "/models/bge-small-zh-v1.5";

/** 主线程 → Worker */
type WorkerInMessage =
  | { type: "init" }
  | { type: "embed"; id: number; texts: string[] };

/** Worker → 主线程 */
type WorkerOutMessage =
  | { type: "progress"; progress: number }
  | { type: "ready"; device: "webgpu" | "wasm"; dtype: "q8" | "q4f16" }
  | { type: "init-error"; message: string }
  | { type: "embed-result"; id: number; vectors: number[][] }
  | { type: "embed-error"; id: number; message: string };

// DOM lib 的 self 是 Window（postMessage 签名不同），结构化收窄到 DedicatedWorker
const scope = self as unknown as {
  postMessage(message: WorkerOutMessage): void;
  onmessage: ((event: MessageEvent<WorkerInMessage>) => void) | null;
};

/** 提取器结构类型：避免依赖库内部 Pipeline 具体类型导出（v4 导出面未逐一核实） */
type Extractor = (
  texts: string[],
  options: { pooling: "cls"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/** progress_callback 载荷（字段全可选：以超类型接收库侧签名，见官方指南示例） */
interface ProgressInfo {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

let extractor: Extractor | null = null;
let activeDevice: "webgpu" | "wasm" = "wasm";

// 跨文件聚合计权进度：按 file 记录 loaded/total，汇总为整体 0~1
const fileProgress = new Map<string, { loaded: number; total: number }>();

function reportProgress(): void {
  let loaded = 0;
  let total = 0;
  for (const v of fileProgress.values()) {
    loaded += v.loaded;
    total += v.total;
  }
  if (total > 0) {
    scope.postMessage({ type: "progress", progress: Math.min(1, loaded / total) });
  }
}

function onProgress(info: ProgressInfo): void {
  if (!info.file) return;
  const prev = fileProgress.get(info.file) ?? { loaded: 0, total: 0 };
  fileProgress.set(info.file, {
    loaded: info.loaded ?? prev.loaded,
    total: info.total ?? prev.total,
  });
  reportProgress();
}

/** 设备探测：WebGPU 可用且支持 shader-f16 才走 q4f16，否则回退 wasm/q8 */
async function detectDevice(): Promise<"webgpu" | "wasm"> {
  // WebGPU 类型不在 TS DOM lib 内，结构化探测以避免引入 @types 依赖
  const gpu = (navigator as unknown as {
    gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> };
  }).gpu;
  if (!gpu) return "wasm";
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return "wasm";
    return adapter.features.has("shader-f16") ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function init(): Promise<void> {
  try {
    const device = await detectDevice();
    const dtype = device === "webgpu" ? "q4f16" : "q8";
    const created = await pipeline("feature-extraction", MODEL_PATH, {
      device,
      dtype,
      progress_callback: onProgress,
    });
    extractor = created as unknown as Extractor;
    activeDevice = device;
    scope.postMessage({ type: "ready", device, dtype });
  } catch (err) {
    scope.postMessage({
      type: "init-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function embed(id: number, texts: string[]): Promise<void> {
  if (!extractor) {
    scope.postMessage({ type: "embed-error", id, message: "引擎未初始化" });
    return;
  }
  try {
    // bge 系列官方口径：CLS 池化 + L2 归一化（pipeline 内完成，无需再归一）
    const output = await extractor(texts, { pooling: "cls", normalize: true });
    scope.postMessage({ type: "embed-result", id, vectors: output.tolist() });
  } catch (err) {
    scope.postMessage({
      type: "embed-error",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "init") {
    void init();
  } else if (msg.type === "embed") {
    void embed(msg.id, msg.texts);
  }
};
