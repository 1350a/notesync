/*
 * 本地推理引擎（主线程封装，Worker 单例）
 *
 * 协议见 doc/browser-local-inference.md §4：
 * - 状态机 idle → loading → ready/error；ready 携带实际后端（webgpu/wasm）；
 * - 设备内事件（WebGPU 回退、persist 被拒）静默处理；
 * - SSR 防护：非浏览器环境一切入口拒绝。
 */

export type LocalEngineStatus =
  | { state: "idle" }
  | { state: "loading"; progress: number }
  | { state: "ready"; device: "webgpu" | "wasm" }
  | { state: "error"; message: string };

/** Worker → 主线程（与 lib/local/worker.ts 的 WorkerOutMessage 保持一致） */
type WorkerOutMessage =
  | { type: "progress"; progress: number }
  | { type: "ready"; device: "webgpu" | "wasm"; dtype: "q8" | "q4f16" }
  | { type: "init-error"; message: string }
  | { type: "embed-result"; id: number; vectors: number[][] }
  | { type: "embed-error"; id: number; message: string };

type ProgressListener = (progress: number) => void;

let worker: Worker | null = null;
let status: LocalEngineStatus = { state: "idle" };
let initPromise: Promise<LocalEngineStatus> | null = null;
let nextRequestId = 1;
let progressListener: ProgressListener | null = null;

interface PendingEmbed {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
}
const pendingEmbeds = new Map<number, PendingEmbed>();

export function getLocalEngineStatus(): LocalEngineStatus {
  return status;
}

function ensureWorker(): Worker {
  if (!worker) {
    // Turbopack 的模块 Worker 约定：new URL + type:'module'，worker 代码独立成 chunk
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "progress":
          status = { state: "loading", progress: msg.progress };
          progressListener?.(msg.progress);
          break;
        case "ready":
          status = { state: "ready", device: msg.device };
          progressListener = null;
          // 存储持久化尽力而为：Safari 7 天驱逐的主要缓解，被拒不影响能力
          void navigator.storage?.persist?.().catch(() => {});
          break;
        case "init-error":
          status = { state: "error", message: msg.message };
          progressListener = null;
          break;
        case "embed-result": {
          const pending = pendingEmbeds.get(msg.id);
          pendingEmbeds.delete(msg.id);
          pending?.resolve(msg.vectors.map((v) => Float32Array.from(v)));
          break;
        }
        case "embed-error": {
          const pending = pendingEmbeds.get(msg.id);
          pendingEmbeds.delete(msg.id);
          pending?.reject(new Error(msg.message));
          break;
        }
      }
    };
  }
  return worker;
}

/**
 * 初始化引擎（惰性单例；并发调用共享同一次初始化）。
 * @param onProgress 下载/编译整体进度 0~1（仅 loading 阶段回调）
 */
export function initLocalEngine(
  onProgress?: ProgressListener,
): Promise<LocalEngineStatus> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("本地推理仅能在浏览器环境运行"));
  }
  progressListener = onProgress ?? null;
  if (initPromise) return initPromise;

  status = { state: "loading", progress: 0 };
  const w = ensureWorker();
  const promise = new Promise<LocalEngineStatus>((resolve) => {
    const onSettled = () => {
      w.removeEventListener("message", onSettledEvent);
      resolve(status);
    };
    const onSettledEvent = (event: MessageEvent<WorkerOutMessage>) => {
      if (event.data.type === "ready" || event.data.type === "init-error") {
        onSettled();
      }
    };
    // init 的终态由一次性监听器收口；常驻 onmessage 继续驱动状态机
    w.addEventListener("message", onSettledEvent);
    w.postMessage({ type: "init" });
  });
  initPromise = promise;
  // 失败后允许重试：清空单例 promise（worker 保留复用，init 可重发）
  void promise.then(() => {
    if (status.state === "error") initPromise = null;
  });
  return promise;
}

/** 经 Worker 批量嵌入（须引擎就绪；先 initLocalEngine） */
export function engineEmbed(texts: string[]): Promise<Float32Array[]> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("本地推理仅能在浏览器环境运行"));
  }
  if (status.state !== "ready" || !worker) {
    return Promise.reject(new Error("本地推理引擎未就绪"));
  }
  const w = worker;
  const id = nextRequestId++;
  return new Promise<Float32Array[]>((resolve, reject) => {
    pendingEmbeds.set(id, { resolve, reject });
    w.postMessage({ type: "embed", id, texts });
  });
}

/**
 * 终止并释放 Worker（页面卸载或显式释放内存时调用）。
 * 返回 Promise：terminate() 是同步调用，但浏览器丢弃在途消息是异步的，
 * 故让出一个宏任务再 resolve，保证调用方 await 之后重建引擎时，
 * 旧 Worker 的迟到消息（progress/ready/embed-*）不会串入新单例。
 */
export async function disposeLocalEngine(): Promise<void> {
  for (const pending of pendingEmbeds.values()) {
    pending.reject(new Error("引擎已释放"));
  }
  pendingEmbeds.clear();
  const w = worker;
  worker = null;
  initPromise = null;
  progressListener = null;
  status = { state: "idle" };
  if (w) {
    // 先摘除常驻监听再 terminate，避免终止瞬间的消息进入已失效的状态机
    w.onmessage = null;
    w.terminate();
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
