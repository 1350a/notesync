/**
 * 会话标题派生与规整（doc/chat-history.md §2.3）。
 *
 * 规则：取首条用户消息正文前 20 个码点，折叠空白；无有效正文回落「新对话」。
 * 用户手改后由 titleEdited 标记，本模块的派生逻辑不再被自动调用。
 */
import { MAX_TITLE_CHARS, UNTITLED_SESSION } from './types.ts';
import type { HistoryMessage } from './types.ts';

/** 折叠换行/制表/连续空白为单个半角空格：标题是单行文本，保留换行会撑破列表项 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 按码点截断，避免把 emoji / 代理对劈成半个字符 */
export function truncateByCodePoint(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return chars.slice(0, maxChars).join('');
}

/** 从一条用户消息正文派生标题；正文为空/全空白返回「新对话」 */
export function deriveTitle(text: string): string {
  const normalized = truncateByCodePoint(collapseWhitespace(text ?? ''), MAX_TITLE_CHARS);
  return normalized || UNTITLED_SESSION;
}

/** 用户手改标题的规整：折叠空白 + 截断；空输入返回 null 表示「拒绝这次改名」 */
export function normalizeTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = truncateByCodePoint(collapseWhitespace(raw), MAX_TITLE_CHARS);
  return normalized || null;
}

/**
 * 从消息列表派生标题：取第一条正文非空的用户消息。
 * 首条用户消息可能只带附件（正文为空），此时往后找，仍找不到则回落「新对话」。
 */
export function deriveTitleFromMessages(messages: HistoryMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = collapseWhitespace(message.content ?? '');
    if (text) return deriveTitle(text);
  }
  return UNTITLED_SESSION;
}
