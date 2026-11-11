/**
 * 诊断调用成本计量（总账 §9.1：每次诊断调用次数 + token 区间，先日志不进 UI）
 *
 * 口径：
 * - 调用次数：精确值（工具循环轮数 + finalize 重试 + 整卷各步）；
 * - token 区间：请求字符数估算——中文约 1 字/token、英文约 4 字符/token，
 *   给出 [下界, 上界] 而非假精确值（上游 usage 流式消费已挂账，接通后替换为精确值）；
 * - 输出仅 console.log 一行 JSON（[cost] 前缀便于聚合），不影响任何响应。
 */

/** 请求消息的字符总量（多模态 part 只计 text 部分，图片本体不计入字符） */
function charsOf(messages: ReadonlyArray<{ content: unknown }>): number {
  return messages.reduce((sum, m) => {
    const content = m.content;
    if (typeof content === 'string') return sum + content.length;
    if (Array.isArray(content)) {
      return sum + content.reduce((s: number, part) => {
        const text = (part as { text?: unknown }).text;
        return s + (typeof text === 'string' ? text.length : 0);
      }, 0);
    }
    return sum;
  }, 0);
}

export interface CostRecord {
  route: string;
  /** 模型调用次数（精确） */
  calls: number;
  /** 请求字符数（精确） */
  requestChars: number;
  /** token 估算区间 [下界, 上界]：中文密度高取 chars/1，英文密度低取 chars/4 */
  tokensEstimate: [number, number];
  clientId: string;
}

export function estimateCost(input: {
  route: string;
  clientId: string;
  calls: number;
  messages: ReadonlyArray<{ content: unknown }>;
}): CostRecord {
  const requestChars = charsOf(input.messages);
  return {
    route: input.route,
    calls: input.calls,
    requestChars,
    tokensEstimate: [Math.ceil(requestChars / 4), Math.ceil(requestChars / 1)],
    clientId: input.clientId,
  };
}

/** 打一行成本日志；纯日志，永不抛错 */
export function logCost(record: CostRecord): void {
  try {
    console.log(`[cost] ${JSON.stringify(record)}`);
  } catch {
    // 日志是纯增益
  }
}
