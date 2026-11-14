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
 *
 * 存储形态（v2 分片）：单键整体序列化会踩两个坑——①写一次要把全部历史重新序列化，
 * 长会话下几 MB 字符串一次性写回，容易卡主线程；②只要有一条异常数据，整库 JSON.parse
 * 就失败、历史全丢。因此改为「索引键 + 按条分片」：
 *   - 索引键 `notesync-trace-v2-index`：只存元数据（id / startedAt / route / model / size / truncated），
 *     加载列表时不碰大字符串；
 *   - 分片键 `notesync-trace-v2-<id>`：一条 trace 一个键，单条超限只截自己的 events 尾部；
 *   - 坏片（解析失败）单独跳过，不牵连其它记录；
 *   - 淘汰按条数（TRACE_KEEP）删最旧片，单条上限仍由 TRACE_MAX_CHARS 兜住。
 * v1 单键数据在首次读写时做一次性迁移（写入分片 + 建索引 + 删源键），迁移失败不影响新链路。
 */
import type { ThinkingEffort, TokenUsage } from '@/lib/provider/types';
import { redactTraceText } from '@/lib/safety/redact';

/** 保留最近条数（条 = 一次请求的完整事件流） */
export const TRACE_KEEP = 20;

/** 单条 trace 的字符上限：超过即从尾部截断事件数组（防单条撑爆配额） */
export const TRACE_MAX_CHARS = 200_000;

/** userInput 入库上限：留足够定位问题的开头，又不把整段长文本撑进 trace */
export const TRACE_USER_INPUT_MAX_CHARS = 200;

/** 索引键（v2）：只放元数据，列表加载不读分片 */
export const TRACE_INDEX_KEY = 'notesync-trace-v2-index';
/** 分片键前缀（v2）：完整拼法 `${TRACE_SHARD_PREFIX}${id}` */
export const TRACE_SHARD_PREFIX = 'notesync-trace-v2-';
/** v1 单键（仅用于一次性迁移，迁移后删除） */
export const TRACE_LEGACY_KEY = 'notesync-trace-v1';

/** localStorage 的最小可用面（node 测试环境无 window，用注入的假实现） */
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // 隐私模式/配额异常下访问 localStorage 会抛
    return null;
  }
}

/** 索引条目：够列表展示与定位，不含事件体 */
export interface TraceIndexEntry {
  /** 分片键后缀，同时是稳定排序依据（写入时生成的单调前缀 + 随机后缀） */
  id: string;
  startedAt: string;
  route: string;
  model?: string;
  /** 分片序列化后的字符数，用来估算占用（不读分片也能显示） */
  size: number;
  /** 该条是否被截断过 */
  truncated?: boolean;
}

export interface TraceEvent {
  /** 相对请求起点的毫秒数 */
  ms: number;
  event: string;
  data: unknown;
}

/** 本轮被拦截的归因（safety-protocol §3：两条路径处置相同，根因不同） */
export interface TraceBlocked {
  /** finish_reason 异常值 = 'finish_reason'；拒绝性文本 = 'content'；服务端输入兜底 = 'input_guard' */
  signal: 'finish_reason' | 'content' | 'input_guard';
  /** 归一后的错误码：content_blocked / input_blocked（预留给后续细分） */
  code?: string;
  /** 上游 finish_reason 原值（signal='finish_reason' 时有值） */
  finishReason?: string;
  /** 输入兜底命中的类别（signal='input_guard' 时有值）：structure / injection / psych / hardRisk */
  category?: string;
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
  /** 该条是否被截断过（单条超 TRACE_MAX_CHARS 时丢事件尾部） */
  truncated?: boolean;
  /** 被丢弃的事件条数（truncated 时有值） */
  eventsDropped?: number;
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

/** 分片键完整名称 */
function shardKey(id: string): string {
  return `${TRACE_SHARD_PREFIX}${id}`;
}

/** 索引条目形状校验：坏条目跳过，不连带整库 */
function isIndexEntry(value: unknown): value is TraceIndexEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<TraceIndexEntry>;
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.startedAt === 'string' &&
    typeof entry.route === 'string' &&
    typeof entry.size === 'number'
  );
}

/** 分片形状校验：缺关键字段视为坏片 */
function isTraceLike(value: unknown): value is Trace {
  if (!value || typeof value !== 'object') return false;
  const trace = value as Partial<Trace>;
  return (
    typeof trace.startedAt === 'string' &&
    typeof trace.route === 'string' &&
    Array.isArray(trace.events)
  );
}

function readIndex(storage: StorageLike): TraceIndexEntry[] {
  try {
    const raw = storage.getItem(TRACE_INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isIndexEntry);
  } catch {
    // 索引坏：当作空索引（分片仍在，但无法枚举，不主动删用户数据）
    return [];
  }
}

function writeIndex(storage: StorageLike, entries: TraceIndexEntry[]): void {
  storage.setItem(TRACE_INDEX_KEY, JSON.stringify(entries));
}

/** 分片 id：时间戳 + 随机后缀，保证唯一（顺序以索引数组为准） */
function nextTraceId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 单条截断：超 TRACE_MAX_CHARS 时从 events 尾部按比例丢弃，直到落进上限。
 * 只截自己这一条，历史其它分片不受影响。
 */
function capTrace(trace: Trace): { raw: string; truncated: boolean; eventsDropped: number } {
  let raw = JSON.stringify(trace);
  if (raw.length <= TRACE_MAX_CHARS) return { raw, truncated: false, eventsDropped: 0 };

  let events = trace.events;
  let dropped = 0;
  while (raw.length > TRACE_MAX_CHARS && events.length > 0) {
    const dropCount = Math.max(1, Math.ceil(events.length / 4));
    events = events.slice(0, events.length - dropCount);
    dropped += dropCount;
    raw = JSON.stringify({ ...trace, events, truncated: true, eventsDropped: dropped });
  }
  return { raw, truncated: true, eventsDropped: dropped };
}

/** 写一条分片，返回索引条目；写入失败返回 null（不抛给调用方） */
function writeShard(storage: StorageLike, trace: Trace): TraceIndexEntry | null {
  const capped = capTrace(trace);
  const id = nextTraceId();
  try {
    storage.setItem(shardKey(id), capped.raw);
  } catch {
    return null; // 配额满等：本条放弃，不影响既有分片
  }
  return {
    id,
    startedAt: trace.startedAt,
    route: trace.route,
    ...(trace.model ? { model: trace.model } : {}),
    size: capped.raw.length,
    ...(capped.truncated ? { truncated: true } : {}),
  };
}

/** v1 单键 → v2 分片的一次性迁移（迁移后删源键，避免重复搬） */
function migrateLegacy(storage: StorageLike): void {
  let legacyRaw: string | null = null;
  try {
    legacyRaw = storage.getItem(TRACE_LEGACY_KEY);
  } catch {
    return;
  }
  if (legacyRaw === null) return;

  let legacy: Trace[] = [];
  try {
    const parsed: unknown = JSON.parse(legacyRaw);
    if (Array.isArray(parsed)) legacy = parsed.filter(isTraceLike);
  } catch {
    legacy = []; // v1 整体损坏：丢弃源键，不让旧数据拖住新链路
  }

  // 已有 v2 索引时不重复搬（避免重复记录），仅清掉源键
  if (readIndex(storage).length === 0 && legacy.length > 0) {
    const migrated: TraceIndexEntry[] = [];
    for (const trace of legacy.slice(-TRACE_KEEP)) {
      const entry = writeShard(storage, trace);
      if (entry) migrated.push(entry);
    }
    if (migrated.length > 0) {
      try {
        writeIndex(storage, migrated);
      } catch {
        // 索引写失败：保留源键，下次再试
        return;
      }
    }
  }
  try {
    storage.removeItem(TRACE_LEGACY_KEY);
  } catch {
    // 静默
  }
}

/** 读取全部持久化 trace（旧的在前）；坏片单独跳过，不整库丢弃 */
export function loadTraces(): Trace[] {
  const storage = getStorage();
  if (!storage) return [];
  migrateLegacy(storage);

  const traces: Trace[] = [];
  for (const entry of readIndex(storage)) {
    try {
      const raw = storage.getItem(shardKey(entry.id));
      if (!raw) continue; // 分片缺失：跳过
      const parsed: unknown = JSON.parse(raw);
      if (!isTraceLike(parsed)) continue; // 形状不对：跳过
      traces.push(parsed);
    } catch {
      continue; // 坏片（JSON 损坏）：跳过，其余照常返回
    }
  }
  return traces;
}

/** 请求结束：写一条分片 + 更新索引（按条数淘汰最旧片），失败静默 */
export function finalizeTrace(trace: Trace): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    migrateLegacy(storage);

    const entry = writeShard(storage, trace);
    if (!entry) return;

    const index = [...readIndex(storage), entry];
    // 淘汰：超 TRACE_KEEP 从最旧的分片开始删（单条上限已由 capTrace 兜住）
    while (index.length > TRACE_KEEP) {
      const evicted = index.shift();
      if (evicted) {
        try {
          storage.removeItem(shardKey(evicted.id));
        } catch {
          // 删不掉也不影响索引推进
        }
      }
    }
    writeIndex(storage, index);
  } catch {
    // 纯增益，失败不打扰
  }
}

/** 清空 trace（设置页清除本地数据时随 LOCAL_PREFIX 一起清，无需单独入口；此函数供测试用） */
export function clearTraces(): void {
  const storage = getStorage();
  if (!storage) return;
  const index = readIndex(storage);
  try {
    for (const entry of index) storage.removeItem(shardKey(entry.id));
    storage.removeItem(TRACE_INDEX_KEY);
    storage.removeItem(TRACE_LEGACY_KEY);
  } catch {
    // 静默
  }
}

/**
 * 导出前的脱敏副本（批次 3-C）：只复制、不改原对象，浏览器内存储保持完整推理。
 *
 * 递归只处理「值」不处理「键」——键名是 trace 结构契约，改了会让下游读不懂；
 * 字符串值统一走 {@link redactTraceText}（公式/代码/链接有白名单保护）。
 */
function redactExportValue(value: unknown): unknown {
  if (typeof value === 'string') return redactTraceText(value);
  if (Array.isArray(value)) return value.map(redactExportValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactExportValue(item);
    }
    return out;
  }
  return value;
}

/** 单条 trace 的导出副本（供导出与单测复用） */
export function redactTraceForExport(trace: Trace): Trace {
  return redactExportValue(trace) as Trace;
}

/** 导出 payload（脱敏后的副本，`null, 2` 美化） */
export function buildTraceExportPayload(traces: Trace[]): string {
  return JSON.stringify(traces.map(redactTraceForExport), null, 2);
}

/** 导出为可下载的 JSON 文件（设置页入口） */
export function downloadTraces(): void {
  const traces = loadTraces();
  const blob = new Blob([buildTraceExportPayload(traces)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `notesync-trace-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
