/**
 * 会话历史搜索 - 纯函数（协议见 doc/chat-history.md §5、§7.4）。
 *
 * 口径：子串匹配（String.includes），大小写不敏感，全角先转半角再比；
 * 匹配范围是会话标题 + 消息正文（content / ocrTexts / files[].text），不含图片与推理过程；
 * 结果上限 50 条，仍按 updatedAt 倒序，标题命中优先于正文命中。
 */
import type { ChatMsg } from '../chat/messages.ts';
import type { SessionMeta } from './types.ts';

/** 命中上限：再多用户也翻不动，且正文扫描要逐条回读，必须早点停 */
export const SEARCH_HIT_LIMIT = 50;
/** 输入防抖窗口 */
export const SEARCH_DEBOUNCE_MS = 200;
/** 单次搜索最多回读多少条会话的正文（超出只按标题匹配） */
export const SEARCH_BODY_SCAN_LIMIT = 500;
/** 正文回读的并行批大小：IDB 单连接上并发事务安全，8 是延迟与内存占用的平衡点 */
export const SEARCH_SCAN_BATCH = 8;

/** 全角 ASCII → 半角、全角空格 → 半角空格、统一小写 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase();
}

/** 关键词归一：用户输入两侧空白不该参与匹配 */
export function normalizeKeyword(raw: string): string {
  return normalizeText(raw).trim();
}

/** 标题匹配；空关键词视为全部命中 */
export function matchMeta(meta: SessionMeta, keyword: string): boolean {
  if (!keyword) return true;
  return normalizeText(meta.title).includes(keyword);
}

/**
 * 单条消息匹配；空关键词视为命中。
 * ocrTexts 与 images 槽位一一对应，空串槽位（过期/未识别）不参与匹配。
 */
export function matchMessage(msg: ChatMsg, keyword: string): boolean {
  if (!keyword) return true;
  if (msg.content && normalizeText(msg.content).includes(keyword)) return true;
  for (const ocr of msg.ocrTexts ?? []) {
    if (ocr && normalizeText(ocr).includes(keyword)) return true;
  }
  for (const file of msg.files ?? []) {
    if (normalizeText(file.text).includes(keyword)) return true;
  }
  return false;
}

/** 正文匹配；空关键词视为全部命中 */
export function matchMessages(messages: readonly ChatMsg[], keyword: string): boolean {
  if (!keyword) return true;
  return messages.some((msg) => matchMessage(msg, keyword));
}

/**
 * 首条命中消息的下标（供搜索跳转定位）；无命中或空关键词返回 -1。
 * 空关键词语义与 matchMessages 的"全命中"不同：跳转没有可定位的词，明确返回 -1。
 */
export function findFirstHitIndex(messages: readonly ChatMsg[], keyword: string): number {
  if (!keyword) return -1;
  return messages.findIndex((msg) => matchMessage(msg, keyword));
}

/** 合并标题命中与正文命中：去重、倒序、截断到上限 */
export function mergeHits(
  titleHits: readonly SessionMeta[],
  bodyHits: readonly SessionMeta[],
  limit = SEARCH_HIT_LIMIT
): SessionMeta[] {
  const seen = new Set<string>();
  const merged: SessionMeta[] = [];
  for (const meta of [...titleHits, ...bodyHits]) {
    if (seen.has(meta.id)) continue;
    seen.add(meta.id);
    merged.push(meta);
  }
  merged.sort((a, b) => b.updatedAt - a.updatedAt);
  return merged.slice(0, limit);
}
