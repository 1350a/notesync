/**
 * 提交前校验（C1）单测：拦回英文 code 与内部字段名，且一次只报一个点。
 */
import { describe, expect, it } from 'vitest';
import { ERROR_CAUSES } from '@/lib/diagnose/error-causes';
import { RETRY_HINTS } from '@/lib/diagnose/prompts';
import { collectVisibleTexts, detectSubmissionLeak } from '@/lib/diagnose/submission-guard';

const CODE = ERROR_CAUSES[0].code;

/** 一份干净的 L2 提交：错因 code 只在字段里，可见文本全是中文 */
function cleanArgs(): Record<string, unknown> {
  return {
    isMath: true,
    level: 'L2',
    knowledgePoints: ['一元二次方程求根', '判别式'],
    errorCause: { code: CODE, confidence: 0.8 },
    notes: '学生用求根公式时把判别式算成了 b²+4ac',
  };
}

describe('submission-guard：提交文本泄漏判定', () => {
  it('干净提交返回 null', () => {
    expect(detectSubmissionLeak(cleanArgs())).toBeNull();
  });

  it('errorCause.code 本身合法，不算泄漏', () => {
    const args = cleanArgs();
    args.errorCause = { code: CODE, confidence: 0.5 };
    expect(detectSubmissionLeak(args)).toBeNull();
  });

  it('notes 里出现英文 code → code_leak', () => {
    const args = cleanArgs();
    args.notes = `主错因是 ${CODE}`;
    const leak = detectSubmissionLeak(args);
    expect(leak?.kind).toBe('code_leak');
    expect(leak?.field).toBe('notes');
  });

  it('考点里出现英文 code → code_leak', () => {
    const args = cleanArgs();
    args.knowledgePoints = ['判别式', CODE];
    const leak = detectSubmissionLeak(args);
    expect(leak?.kind).toBe('code_leak');
    expect(leak?.field).toBe('knowledgePoints[1]');
  });

  it('提示阶梯 content 里出现英文 code → code_leak', () => {
    const args = cleanArgs();
    args.hints = [{ level: 1, content: `先想想 ${CODE} 这一步` }];
    const leak = detectSubmissionLeak(args);
    expect(leak?.kind).toBe('code_leak');
    expect(leak?.field).toBe('hints[0].content');
  });

  it('notes 里出现内部字段名 → field_leak', () => {
    const args = cleanArgs();
    args.notes = '本次按 hasStudentAnswer=false 处理';
    const leak = detectSubmissionLeak(args);
    expect(leak?.kind).toBe('field_leak');
    expect(leak?.sample).toBe('hasStudentAnswer');
  });

  it('中文与标识符直接相邻时也要命中（\\b 会漏判的形态）', () => {
    const args = cleanArgs();
    args.notes = '作答completeness标记为 false';
    expect(detectSubmissionLeak(args)?.kind).toBe('field_leak');
  });

  it('只是恰好包含前缀、不构成独立标识符时不误伤', () => {
    const args = cleanArgs();
    args.notes = '这道题的关键是 discriminantStyle 的写法';
    expect(detectSubmissionLeak(args)).toBeNull();
  });

  it('同时命中两类时先报 code_leak（一次只纠一个点）', () => {
    const args = cleanArgs();
    args.notes = `${CODE} 与 hasStudentAnswer 同时出现`;
    expect(detectSubmissionLeak(args)?.kind).toBe('code_leak');
  });

  it('空串与非字符串可见文本被跳过', () => {
    const texts = collectVisibleTexts({ notes: '   ', knowledgePoints: [1, null], hints: [null, { level: 1 }] });
    expect(texts).toHaveLength(0);
  });
});

describe('prompts：重试指令表按原因枚举', () => {
  it('四个原因都有非空指令，且互不重复', () => {
    const kinds = ['missing_submission', 'missing_quote', 'code_leak', 'field_leak'] as const;
    for (const kind of kinds) expect(RETRY_HINTS[kind].trim().length).toBeGreaterThan(0);
    expect(new Set(kinds.map((kind) => RETRY_HINTS[kind])).size).toBe(kinds.length);
  });

  it('code_leak / field_leak 只讲自己那一个点', () => {
    expect(RETRY_HINTS.code_leak).toContain('中文错因名');
    expect(RETRY_HINTS.code_leak).not.toContain('内部字段名');
    expect(RETRY_HINTS.field_leak).toContain('学生能懂');
    expect(RETRY_HINTS.field_leak).not.toContain('中文错因名');
  });
});
