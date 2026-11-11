/**
 * SSE 事件流 trace 落盘（P3：复用现有 SSE 事件存本地，供调试看时间线）
 *
 * 客户端模块：useChat 在每次请求期间调用 record 累积事件（带毫秒时间戳），
 * 请求结束 finalize 成一条 trace；环形保留最近 TRACE_KEEP 条，localStorage 持久。
 * 设置页「数据」分区提供导出入口（下载 JSON）。纯调试设施：读写失败静默跳过。
 */

/** 保留最近条数（条 = 一次请求的完整事件流） */
export const TRACE_KEEP = 20;

/** 单条 trace 的字符上限：超过即截断事件数组（防长会话撑爆 localStorage） */
const TRACE_MAX_CHARS = 200_000;

const TRACE_STORAGE_KEY = 'notesync-trace-v1';

export interface TraceEvent {
  /** 相对请求起点的毫秒数 */
  ms: number;
  event: string;
  data: unknown;
}

export interface Trace {
  /** 请求起点（绝对时间 ISO） */
  startedAt: string;
  route: string;
  model?: string;
  events: TraceEvent[];
}

/** 新建一条 trace 的时间戳基准 */
export function startTrace(route: string, model?: string): Trace {
  return { startedAt: new Date().toISOString(), route, model, events: [] };
}

export function recordEvent(trace: Trace, event: string, data: unknown): void {
  trace.events.push({ ms: Date.now() - new Date(trace.startedAt).getTime(), event, data });
}

/** 读取全部持久化 trace（旧的在前）；解析失败整库丢弃（纯调试设施，不修复坏数据） */
export function loadTraces(): Trace[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TRACE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Trace[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 请求结束：落盘（环形保留 + 字符截断），失败静默 */
export function finalizeTrace(trace: Trace): void {
  if (typeof window === 'undefined') return;
  try {
    const all = [...loadTraces(), trace].slice(-TRACE_KEEP);
    let serialized = JSON.stringify(all);
    // 超限先丢最旧的一条再重试（最多几轮即可收敛）
    while (serialized.length > TRACE_MAX_CHARS && all.length > 1) {
      all.shift();
      serialized = JSON.stringify(all);
    }
    window.localStorage.setItem(TRACE_STORAGE_KEY, serialized);
  } catch {
    // 纯增益，失败不打扰
  }
}

/** 清空 trace（设置页清除本地数据时随 LOCAL_PREFIX 一起清，无需单独入口；此函数供测试用） */
export function clearTraces(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TRACE_STORAGE_KEY);
  } catch {
    // 静默
  }
}

/** 导出为可下载的 JSON 文件（设置页入口） */
export function downloadTraces(): void {
  const traces = loadTraces();
  const blob = new Blob([JSON.stringify(traces, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `notesync-trace-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
