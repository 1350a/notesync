/**
 * SSE 事件流 trace 落盘（P3：复用现有 SSE 事件存本地，供调试看时间线）
 *
 * 客户端模块：useChat 在每次请求期间调用 record 累积事件（带毫秒时间戳），
 * 请求结束 finalize 成一条 trace；环形保留最近 TRACE_KEEP 条，localStorage 持久。
 * 设置页「数据」分区提供导出入口（下载 JSON）。纯调试设施：读写失败静默跳过。
 *
 * 观测面（2026-11 补齐）：除事件流外，trace 还固化「谁问的、什么档位、烧了多少 token、
 * 有没有被拦、处在诊断哪一态、属于哪个会话」——缺这些字段时，档位强弱与拦截归因
 * 只能靠翻事件流猜（详见 doc/implementation-status.md 偏差项）。
 */
import type { ThinkingEffort, TokenUsage } from '@/lib/provider/types';

/** 保留最近条数（条 = 一次请求的完整事件流） */
export const TRACE_KEEP = 20;

/** 单条 trace 的字符上限：超过即截断事件数组（防长会话撑爆 localStorage） */
const TRACE_MAX_CHARS = 200_000;

/** userInput 入库上限：留足够定位问题的开头，又不把整段长文本撑进 trace */
export const TRACE_USER_INPUT_MAX_CHARS = 200;

const TRACE_STORAGE_KEY = 'notesync-trace-v1';

export interface TraceEvent {
  /** 相对请求起点的毫秒数 */
  ms: number;
  event: string;
  data: unknown;
}

/** 本轮被上游拦截的归因（safety-protocol §3：两条路径处置相同，根因不同） */
export interface TraceBlocked {
  /** finish_reason 异常值 = 'finish_reason'；拒绝性文本 = 'content' */
  signal: 'finish_reason' | 'content';
  /** 归一后的错误码（当前恒为 content_blocked，预留给后续细分） */
  code?: string;
  /** 上游 finish_reason 原值（signal='finish_reason' 时有值） */
  finishReason?: string;
}

export interface Trace {
  /** 请求起点（绝对时间 ISO） */
  startedAt: string;
  route: string;
  model?: string;
  /** 会话 ID：把同一会话的多条请求串起来（首条消息前为空） */
  conversationId?: string;
  /** 请求时的思考强度档位；未设置（跟随 provider 默认）时缺省 */
  thinkingEffort?: ThinkingEffort;
  /** 用户输入片段（截断至 TRACE_USER_INPUT_MAX_CHARS），用于把记录对回实际问题 */
  userInput?: string;
  /** 上游 token 用量；上游未返回时缺省，不得当作 0 */
  usage?: TokenUsage;
  /** 本轮被拦截时填充（含 signal / code / finishReason） */
  blocked?: TraceBlocked;
  /** 诊断七态（诊断路由才有；普通聊天缺省） */
  diagnoseState?: string;
  events: TraceEvent[];
}

/** startTrace 的可选观测面参数（缺省即保持旧行为） */
export interface TraceMeta {
  conversationId?: string;
  thinkingEffort?: ThinkingEffort;
  userInput?: string;
  diagnoseState?: string;
}

/** 用户输入截断：超长只留开头，并标注已截断 */
export function truncateUserInput(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= TRACE_USER_INPUT_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, TRACE_USER_INPUT_MAX_CHARS)}…[截断 ${trimmed.length - TRACE_USER_INPUT_MAX_CHARS} 字]`;
}

/** 新建一条 trace 的时间戳基准 */
export function startTrace(route: string, model?: string, meta?: TraceMeta): Trace {
  return {
    startedAt: new Date().toISOString(),
    route,
    model,
    ...(meta?.conversationId ? { conversationId: meta.conversationId } : {}),
    ...(meta?.thinkingEffort ? { thinkingEffort: meta.thinkingEffort } : {}),
    ...(meta?.userInput ? { userInput: truncateUserInput(meta.userInput) } : {}),
    ...(meta?.diagnoseState ? { diagnoseState: meta.diagnoseState } : {}),
    events: [],
  };
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
