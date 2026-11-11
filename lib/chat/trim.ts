/**
 * 长会话上下文裁剪（总账 §9.1：不设硬边界，长会话只保留当前题相关）
 *
 * 策略（D 级，实测可调）：从最新消息向前累积字符预算，超出即截停，
 * 被裁掉的早期消息以一行省略提示留痕（能力降级不静默，与图片/文件省略同口径）。
 * 最新一条用户消息永不裁（当前题的输入）；system 消息由调用方注入、不在裁剪范围。
 * 服务端纯函数：route.ts 在 buildProviderMessages 之后、runToolLoop 之前调用。
 */
import type { ProviderMessage } from '../provider/types.ts';

/** 字符预算（约 12k token 量级；TRIM_BUDGET_CHARS 可覆盖，0=禁用裁剪） */
export const DEFAULT_TRIM_BUDGET_CHARS = 24_000;

export const TRIM_NOTICE = '[更早的对话已因会话过长被省略，仅保留与当前题目相关的最近内容]';

function messageChars(m: ProviderMessage): number {
  if (typeof m.content === 'string') return m.content.length;
  return m.content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0);
}

export interface TrimResult {
  messages: ProviderMessage[];
  /** 被裁掉的消息条数 */
  dropped: number;
  /** 是否实际发生裁剪 */
  trimmed: boolean;
}

export function resolveTrimBudget(): number {
  const parsed = parseInt(process.env.TRIM_BUDGET_CHARS || '', 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_TRIM_BUDGET_CHARS;
}

/**
 * 预算裁剪：预算内原样返回（不触发）；超预算时从最旧一侧丢弃非最新用户消息，
 * 裁剪点插入省略提示。工具消息（role=tool）跟随其所属轮次，按普通消息同一预算处理。
 */
export function trimMessages(messages: ProviderMessage[], budget = resolveTrimBudget()): TrimResult {
  if (budget <= 0 || messages.length === 0) {
    return { messages, dropped: 0, trimmed: false };
  }
  const total = messages.reduce((sum, m) => sum + messageChars(m), 0);
  if (total <= budget) {
    return { messages, dropped: 0, trimmed: false };
  }

  // 最新一条 user 消息的下标：当前题的输入，永不裁
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  // 从最新向最旧累积；预算耗尽前的消息保留（含其后的 tool 消息与最新 user）
  const keep = new Array<boolean>(messages.length).fill(false);
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = messageChars(messages[i]);
    // 最新 user 无条件保留；其余在预算内才保留（预算剩余不足 200 字符即收口，给省略提示留位）
    if (i === lastUserIndex || used + cost <= budget - 200) {
      keep[i] = true;
      used += cost;
    } else {
      break;
    }
  }

  const kept: ProviderMessage[] = [];
  let dropped = 0;
  let noticeInserted = false;
  messages.forEach((m, i) => {
    if (keep[i]) {
      kept.push(m);
    } else if (!noticeInserted) {
      dropped += 1;
      // 省略提示插在保留段的最前面（第一条被裁消息的位置）
      kept.push({ role: 'user', content: TRIM_NOTICE });
      noticeInserted = true;
    } else {
      dropped += 1;
    }
  });

  return { messages: kept, dropped, trimmed: true };
}
