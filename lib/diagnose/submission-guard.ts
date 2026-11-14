/**
 * 提交前校验（C1）：把「不许写英文 code、不许外泄内部字段名」从提示词的自查句搬到代码。
 *
 * 落点在 submit_diagnosis 的 handler 里、提交落地之前：命中就抛错，由 lib/tools/invoke.ts
 * 统一包成 ok=false 回填模型。此时正文还没定稿，模型能在同一轮 loop 内改完重交，
 * 不需要等下一轮用户消息来兜——这是提示词自查做不到的（自查只能约束生成，不能事后拦截）。
 *
 * 只查**学生可见的提交文本**（notes / 考点 / 提示阶梯）：
 * - errorCause.code 本身就该是英文枚举，不查；
 * - 模型输出的正文由 route 流式直发、请求结束时已到学生屏幕上，工具层看不到也改不了，
 *   所以这里不做正文检测——正文侧只留 finalize 的 guard 引用判据。
 *
 * 两类问题一次只报一个（先 code 后字段名）：一次只纠正一个点，模型不会因为多问题并列而漏改。
 */
import { ERROR_CAUSES } from './error-causes.ts';

export type SubmissionFailureKind = 'code_leak' | 'field_leak';

export interface SubmissionLeak {
  kind: SubmissionFailureKind;
  /** 命中的标识符（日志定位用，不回填模型） */
  sample: string;
  /** 命中所在字段，便于日志排查 */
  field: string;
}

/** 内部字段名与后台术语：出现在学生可见文本里即为泄漏 */
const INTERNAL_TERMS = [
  'completeness',
  'hasStudentAnswer',
  'hasCorrectAnswer',
  'hasAnalysis',
  'errorCause',
  'secondaryErrorCause',
  'knowledgePoints',
  'isMath',
] as const;

const CAUSE_CODES: readonly string[] = ERROR_CAUSES.map((cause) => cause.code);

/**
 * 标识符边界判定：用「非标识符字符」而非 \b。
 * 中文与英文直接相邻时 \b 不成立（如「作答hasStudentAnswer」），\b 会漏判。
 */
function includesIdentifier(text: string, token: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${token}(?![A-Za-z0-9_])`).test(text);
}

function pushText(target: Array<{ field: string; text: string }>, field: string, value: unknown): void {
  if (typeof value === 'string' && value.trim()) target.push({ field, text: value });
}

/** 收集学生可见的提交文本 */
export function collectVisibleTexts(args: Record<string, unknown>): Array<{ field: string; text: string }> {
  const texts: Array<{ field: string; text: string }> = [];
  pushText(texts, 'notes', args.notes);

  const points = args.knowledgePoints;
  if (Array.isArray(points)) {
    points.forEach((point, index) => pushText(texts, `knowledgePoints[${index}]`, point));
  }

  const hints = args.hints;
  if (Array.isArray(hints)) {
    hints.forEach((hint, index) => {
      if (hint && typeof hint === 'object') {
        pushText(texts, `hints[${index}].content`, (hint as { content?: unknown }).content);
      }
    });
  }

  return texts;
}

/**
 * 判定提交文本是否泄漏英文 code 或内部字段名。
 * @returns 命中原因；干净提交返回 null
 */
export function detectSubmissionLeak(args: Record<string, unknown>): SubmissionLeak | null {
  const texts = collectVisibleTexts(args);

  for (const { field, text } of texts) {
    for (const code of CAUSE_CODES) {
      if (includesIdentifier(text, code)) return { kind: 'code_leak', sample: code, field };
    }
  }

  for (const { field, text } of texts) {
    for (const term of INTERNAL_TERMS) {
      if (includesIdentifier(text, term)) return { kind: 'field_leak', sample: term, field };
    }
  }

  return null;
}
