/**
 * 上游拦截信号归一（safety-protocol.md §1/§3）
 *
 * 上游行为不对称（DeepSeek 无专门错误码、智谱流中只返回理由），
 * 不能把合规兜底赌在上游——这里把「响应形态信号」统一归一为 content_blocked。
 * 两条判定路径都要覆盖（§3：任一命中即触发，只赌一条会漏）：
 * 1. finish_reason 路径：异常终止值（content_filter 等）；
 * 2. 内容路径：流中出现拒绝性文本（道歉/免责/无法协助）。
 *
 * 内容路径的两处收紧（误报都出在这里）：
 * - 拒绝性特征必须同时含「拒绝动作」+「协助类动词或政策对象」，不再只看「抱歉，不能…」
 *   这种宽搭配——否则「抱歉，这一步不能直接给你答案」这类**系统自己要求的**教学话术
 *   （DISCIPLINE_BLOCK 明令不得直接给答案）会被判成上游拦截，前端弹出「内容被服务商
 *   拒绝」的错误话术，且整轮历史被丢弃；
 * - 系统自身的边界拒答统一以 REFUSAL_PREFIX 开头（isSelfBoundaryRefusal 豁免），
 *   避免把自家合规拒答和上游拦截混为一谈。
 */
import { BLOCKED_FINISH_REASONS } from './block-patterns.ts';
import { REFUSAL_PREFIX } from './messages.ts';

/**
 * 拒绝性文本特征（骨架级：命中任一即疑似拦截；D 级——实测后增删，不必改协议）。
 * 口径：每条都要求「拒绝动作」与「对象」共现，不外推到教学话术的「不能直接给答案」
 * 「无法整段复述解法」——那两句是本系统的输出纪律，不是拦截。
 */
export const REFUSAL_PATTERNS: RegExp[] = [
  // 中文：道歉 + 无法协助/回答/处理（协助类动词必须在，不能只到「不能」）
  /(非常|很)?抱歉[，,]\s*(我)?\s*(无法|不能|不可以|不便)(协助|帮助|回答|处理|提供|满足|回应)/,
  // 中文：无法/不能 + 在此/此事/该请求 + 协助类动词
  /(无法|不能)[在为]?[此这该][^。\n]{0,6}(协助|帮助|回答|处理|提供|回应)/,
  // 中文：违反政策类
  /(违反|违背)[^。\n]{0,10}(使用政策|内容政策|安全策略|相关规定|服务条款)/,
  // 中文：内容/请求被拦截（被字句必须带拦截类动词）
  /(内容|请求|问题|消息)[^。\n]{0,8}(被|已|遭到)[^。\n]{0,6}(拦截|拒绝|阻止|过滤|屏蔽)/,
  // 中文：以「AI/语言模型」身份为由拒绝
  /(作为|身为)(一个)?(AI|人工智能|语言模型)[^。\n]{0,12}(无法|不能|不可以)/,
  // 英文：I'm sorry, but I can't help with ...
  /i('?m| am) sorry,? but i (can('|no)t|am unable to) (help|assist) with (this|that|your)?/i,
  // 英文：cannot assist/help/comply with (this|that) request
  /(cannot|can't|unable to) (assist|help|comply) with (this|that) (request|content)/i,
];

/** finish_reason 路径：异常终止值即判拦截 */
export function isBlockedFinishReason(finishReason: string | undefined | null): boolean {
  if (!finishReason) return false;
  return BLOCKED_FINISH_REASONS.has(finishReason.toLowerCase());
}

/**
 * 是否系统自身的边界拒答：正文开头（剥掉 markdown 装饰后）即以 REFUSAL_PREFIX 开头。
 *
 * 只看开头，不做全文包含判定——否则讲解正文里引用一次前缀就能绕过上游拦截识别。
 * 剥离先于比对：模型常把前缀套进 markdown（**【边界说明】**…），不剥装饰会把自家
 * 合规拒答误判成上游拦截、整轮回复被丢。窗口放宽到前缀 +16 字符，给装饰字符留位。
 */
export function isSelfBoundaryRefusal(text: string): boolean {
  if (!text) return false;
  const head = text
    .replace(/^[\s\u200b-\u200f\ufeff>*#"'「『（(]+/, '')
    .slice(0, REFUSAL_PREFIX.length + 16);
  return head.startsWith(REFUSAL_PREFIX);
}

/** 内容路径：拒绝性文本命中（对累计输出做检查，命中一处即可；自家边界拒答豁免） */
export function containsRefusalText(text: string): boolean {
  if (!text) return false;
  if (isSelfBoundaryRefusal(text)) return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

/** 两路汇合判定（§3：任一命中即触发；finish_reason 异常值不因拒答前缀豁免） */
export function isBlockedSignal(input: { finishReason?: string | null; text?: string }): boolean {
  if (isBlockedFinishReason(input.finishReason)) return true;
  return containsRefusalText(input.text ?? '');
}
