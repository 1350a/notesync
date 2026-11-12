/**
 * 落库数据的清洗与兜底（doc/chat-history.md §4）。
 *
 * 存储层面对的是上一版本写下的、或已损坏的数据，任何一条脏记录都不允许让
 * loadSession 抛错、也不允许污染其余会话。清洗口径一律「尽力保留 + 保位不压缩」：
 * 图片槽位宁可置空串也不删下标，否则后续 blob key 会整体错位串台。
 */
import { MAX_DATA_URL, parseTextFiles } from '../chat/messages.ts';
import type { ToolCallView } from '../chat/messages.ts';
import { normalizeTitle } from './title.ts';
import { MAX_IMAGES_PER_MESSAGE, MAX_MESSAGE_CHARS, UNTITLED_SESSION } from './types.ts';
import type {
  ExpiredImageRef,
  HistoryMessage,
  SessionMeta,
  SessionRecord,
} from './types.ts';

/** 截断超长正文；非字符串一律按空串处理 */
function sanitizeText(raw: unknown, limit: number): string {
  if (typeof raw !== 'string') return '';
  return raw.length > limit ? raw.slice(0, limit) : raw;
}

/**
 * 清洗图片槽位：保留下标，非法项置空串。
 * 空串是「过期/缺失」的通用标记，上行时被 lib/chat/messages.ts 天然过滤。
 */
export function sanitizeImageSlots(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const slots = raw.slice(0, MAX_IMAGES_PER_MESSAGE);
  return slots.map((item) =>
    typeof item === 'string' && item.startsWith('data:image/') && item.length <= MAX_DATA_URL
      ? item
      : ''
  );
}

/** 清洗 OCR 文本：与 images 一一对应，长度不足补空串、超出截断，保证下标对齐 */
function sanitizeOcrTexts(raw: unknown, imageCount: number): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || imageCount === 0) return undefined;
  const out: string[] = [];
  for (let i = 0; i < imageCount; i += 1) {
    const item = raw[i];
    out.push(typeof item === 'string' ? item : '');
  }
  return out.every((text) => text === '') ? undefined : out;
}

/** 清洗工具调用轨迹：字段缺失的条目不致命，逐字段回落 */
function sanitizeToolCalls(raw: unknown): ToolCallView[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ToolCallView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    if (!id || !name) continue;
    const args =
      record.arguments && typeof record.arguments === 'object' && !Array.isArray(record.arguments)
        ? (record.arguments as Record<string, unknown>)
        : {};
    const view: ToolCallView = { id, name, arguments: args };
    const result = record.result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      view.result = {
        ok: r.ok === true,
        summary: typeof r.summary === 'string' ? r.summary : '',
        ms: typeof r.ms === 'number' && Number.isFinite(r.ms) ? r.ms : 0,
      };
    }
    out.push(view);
  }
  return out.length > 0 ? out : undefined;
}

/** 气泡是否空到没有保留价值：既无正文也无任何附件/结构化内容 */
function isEmptyBubble(message: HistoryMessage): boolean {
  const hasText = message.content.trim().length > 0;
  const hasImages = (message.images ?? []).some((src) => src !== '');
  const hasOcr = (message.ocrTexts ?? []).some((text) => text !== '');
  const hasFiles = (message.files ?? []).length > 0;
  if (message.role === 'assistant') {
    return (
      !hasText &&
      !message.reasoning?.trim() &&
      !hasImages &&
      !hasOcr &&
      !hasFiles &&
      (message.toolCalls ?? []).length === 0 &&
      (message.awaitingQuestions ?? []).length === 0 &&
      !message.diagnosis
    );
  }
  return !hasText && !hasImages && !hasOcr && !hasFiles;
}

/** 清洗单条消息；role 非法返回 null */
function sanitizeMessage(raw: unknown): HistoryMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const role = record.role;
  if (role !== 'user' && role !== 'assistant') return null;

  const id = typeof record.id === 'string' && record.id ? record.id : undefined;
  const message: HistoryMessage = {
    role,
    content: sanitizeText(record.content, MAX_MESSAGE_CHARS),
  };
  if (id) message.id = id;

  const reasoning = sanitizeText(record.reasoning, MAX_MESSAGE_CHARS);
  if (reasoning) message.reasoning = reasoning;

  const images = sanitizeImageSlots(record.images);
  if (images.length > 0) message.images = images;

  const ocrTexts = sanitizeOcrTexts(record.ocrTexts, images.length);
  if (ocrTexts) message.ocrTexts = ocrTexts;

  if (record.imageSendMode === 'local-only' || record.imageSendMode === 'mixed') {
    message.imageSendMode = record.imageSendMode;
  }

  // 复用请求侧同一套文件口径（缺名/无内容/超限逐项丢弃），避免两处漂移
  const files = parseTextFiles(record.files);
  if (files.length > 0) message.files = files;

  const toolCalls = sanitizeToolCalls(record.toolCalls);
  if (toolCalls) message.toolCalls = toolCalls;

  if (Array.isArray(record.awaitingQuestions) && record.awaitingQuestions.length > 0) {
    message.awaitingQuestions = record.awaitingQuestions as HistoryMessage['awaitingQuestions'];
  }
  if (record.diagnosis && typeof record.diagnosis === 'object') {
    message.diagnosis = record.diagnosis as HistoryMessage['diagnosis'];
  }
  if (record.localOnly === true) message.localOnly = true;
  if (record.blocked === true) message.blocked = true;

  return message;
}

/**
 * 清洗消息数组：非法条目丢弃、同 id 去重（保留首条）、空气泡丢弃。
 * 空气泡是流式中断的典型残留，留着会渲染成一个空白 assistant 条目。
 */
export function sanitizeMessages(raw: unknown): HistoryMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryMessage[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    const message = sanitizeMessage(item);
    if (!message) continue;
    if (message.id) {
      if (seenIds.has(message.id)) continue;
      seenIds.add(message.id);
    }
    if (isEmptyBubble(message)) continue;
    out.push(message);
  }
  return out;
}

/** 清洗过期位置列表：去重、限定为有效下标区间内的整数对 */
export function sanitizeExpiredRefs(raw: unknown, messageCount: number): ExpiredImageRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ExpiredImageRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const msg = record.msg;
    const img = record.img;
    if (!Number.isInteger(msg) || (msg as number) < 0 || (msg as number) >= messageCount) continue;
    if (!Number.isInteger(img) || (img as number) < 0) continue;
    const key = `${msg}:${img}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ msg: msg as number, img: img as number });
  }
  return out;
}

/** 清洗会话体；id 缺失或消息数组非法即视为该条记录损坏（返回 null 交由调用方删除） */
export function sanitizeRecord(raw: unknown): SessionRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id ? record.id : '';
  if (!id) return null;
  const messages = sanitizeMessages(record.messages);
  return {
    id,
    messages,
    expiredImages: sanitizeExpiredRefs(record.expiredImages, messages.length),
  };
}

/** 清洗会话头；时间戳非法回落 0，标题交由 normalizeTitle 兜底 */
export function sanitizeMeta(raw: unknown): SessionMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id ? record.id : '';
  if (!id) return null;

  const numberOrZero = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

  const createdAt = numberOrZero(record.createdAt);
  return {
    id,
    title: normalizeTitle(record.title) ?? UNTITLED_SESSION,
    createdAt,
    updatedAt: numberOrZero(record.updatedAt) || createdAt,
    messageCount: Math.floor(numberOrZero(record.messageCount)),
    textBytes: Math.floor(numberOrZero(record.textBytes)),
    attachmentBytes: Math.floor(numberOrZero(record.attachmentBytes)),
    titleEdited: record.titleEdited === true,
  };
}
