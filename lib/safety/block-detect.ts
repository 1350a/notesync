/**
 * 上游拦截信号归一（safety-protocol.md §1/§3）
 *
 * 上游行为不对称（DeepSeek 无专门错误码、智谱流中只返回理由），
 * 不能把合规兜底赌在上游——这里把「响应形态信号」统一归一为 content_blocked。
 * 两条判定路径都要覆盖（§3：任一命中即触发，只赌一条会漏）：
 * 1. finish_reason 路径：异常终止值（content_filter 等）；
 * 2. 内容路径：流中出现拒绝性文本（道歉/免责/无法协助）。
 */
import { BLOCKED_FINISH_REASONS } from './block-patterns.ts';

/** 拒绝性文本特征（骨架级：命中任一即疑似拦截；D 级——实测后增删，不必改协议） */
export const REFUSAL_PATTERNS: RegExp[] = [
  /抱歉[，,].{0,12}(无法|不能|不可以)/,
  /(无法|不能)[在再]?此[内里].{0,8}(协助|帮助|回答|处理)/,
  /(违反|违背).{0,10}(使用政策|内容政策|安全策略|相关规定)/,
  /(内容|请求|问题).{0,8}(被|已).{0,6}(拦截|拒绝|阻止|过滤)/,
  /I('?m| am) sorry,? but I can('|no)t help with/i,
  /cannot (assist|help) with (this|that) request/i,
];

/** finish_reason 路径：异常终止值即判拦截 */
export function isBlockedFinishReason(finishReason: string | undefined | null): boolean {
  if (!finishReason) return false;
  return BLOCKED_FINISH_REASONS.has(finishReason.toLowerCase());
}

/** 内容路径：拒绝性文本命中（对累计输出做检查，命中一处即可） */
export function containsRefusalText(text: string): boolean {
  if (!text) return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

/** 两路汇合判定（§3：任一命中即触发） */
export function isBlockedSignal(input: { finishReason?: string | null; text?: string }): boolean {
  return isBlockedFinishReason(input.finishReason) || containsRefusalText(input.text ?? '');
}
