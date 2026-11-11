/**
 * 完整度推导
 *
 * 契约来源：doc/wip-diagnosis-model.md §1.2 注——四类附件标签（origin/wrong/correct/analysis）
 * 保留为上传分类标签，但完整度判定只看「有无原题」与「有无作答」；解析不参与门槛。
 *
 * 衔接方案（wip-diagnosis-model.md §8 待办「DiagnosisResult 与附件结构如何衔接」的实现口径）：
 * completeness 四布尔由附件 category 推导，仅作留痕，不作诊断分支条件。
 * 注意与 assemble.ts 的容错差异：附件可能被服务端 parseAttachments 逐条丢弃，
 * 这里以「传入列表里还有多少有效项」为准，故留 boolean[] 而非复用 AssembleResult.stats。
 */
import type { DiagnosisCompleteness, ReviseCategory } from './types.ts';

/** 空 text/dataUrl 的附件视为无效，不计入完整度 */
function hasContent(item: { text?: string; dataUrl?: string }): boolean {
  return Boolean((item.text && item.text.trim()) || item.dataUrl);
}

/**
 * 从附件分类列表推导完整度。
 * 输入是逐项校验后幸存的附件（或前端发送前的原始附件），
 * hasProblem 对应 origin 类，hasStudentAnswer 对应 wrong 类。
 */
export function deriveCompleteness(
  items: ReadonlyArray<{ category: ReviseCategory; text?: string; dataUrl?: string }>,
): DiagnosisCompleteness {
  let hasProblem = false;
  let hasStudentAnswer = false;
  let hasCorrectAnswer = false;
  let hasAnalysis = false;
  for (const item of items) {
    if (!hasContent(item)) continue;
    if (item.category === 'origin') hasProblem = true;
    else if (item.category === 'wrong') hasStudentAnswer = true;
    else if (item.category === 'correct') hasCorrectAnswer = true;
    else if (item.category === 'analysis') hasAnalysis = true;
  }
  return { hasProblem, hasStudentAnswer, hasCorrectAnswer, hasAnalysis };
}

/**
 * L1/L2 判级：仅原题 → L1；有作答 → L2。
 * 「作答」只认 wrong 类附件；解析有无不影响判级（§1.1）。
 */
export function resolveDiagnosisLevel(completeness: DiagnosisCompleteness): 'L1' | 'L2' {
  return completeness.hasStudentAnswer ? 'L2' : 'L1';
}
