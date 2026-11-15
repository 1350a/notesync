import { describe, expect, it } from 'vitest';
import {
  buildGroupDiagnosePrompt,
  buildSplitPrompt,
  classifyQuestions,
  parseJsonLoose,
  parseSplitResult,
  parseSplitResultDetailed,
  type PaperQuestion,
} from '../../../lib/diagnose/paper.ts';

describe('parseJsonLoose / parseSplitResult（切题解析）', () => {
  it('剥围栏与前后缀后解析', () => {
    const raw = '好的，以下是切题结果：\n```json\n[{"number":"1","stem":"解方程"}]\n```\n完毕';
    expect(parseJsonLoose(raw)).toEqual([{ number: '1', stem: '解方程' }]);
  });

  it('对象形态也能截取', () => {
    expect(parseJsonLoose('前缀 {"a":1} 后缀')).toEqual({ a: 1 });
  });

  it('无 JSON / 损坏 JSON 返回 null，不抛错', () => {
    expect(parseJsonLoose('没有结构化内容')).toBeNull();
    expect(parseJsonLoose('[{"stem":')).toBeNull();
  });

  it('切题结果：缺题号按序补，无 stem 的项丢弃，全无效为 null（§5.2 降级触发条件）', () => {
    const parsed = parseSplitResult('[{"stem":"题一"},{"number":"3","stem":"题三"},{"type":"选择题"}]');
    expect(parsed).toEqual([
      { number: '第1题', stem: '题一' },
      { number: '3', stem: '题三' },
    ]);
    expect(parseSplitResult('[{"type":"选择题"}]')).toBeNull();
    expect(parseSplitResult('not json')).toBeNull();
  });

  it('answer/type 缺省安全', () => {
    const parsed = parseSplitResult('[{"stem":"题","answer":"答","type":"解答题"}]');
    expect(parsed?.[0]).toMatchObject({ stem: '题', answer: '答', type: '解答题' });
  });
});

describe('parseSplitResultDetailed（失败原因分层）', () => {
  it('无 JSON / 无题目数组 / 空数组 / 全无题干 各给出独立原因', () => {
    expect(parseSplitResultDetailed('没有结构化内容')).toEqual({ ok: false, reason: 'not_json' });
    expect(parseSplitResultDetailed('{"error":"无法识别题面"}')).toEqual({ ok: false, reason: 'not_array' });
    expect(parseSplitResultDetailed('[]')).toEqual({ ok: false, reason: 'empty' });
    expect(parseSplitResultDetailed('[{"type":"选择题"}]')).toEqual({ ok: false, reason: 'no_stem' });
  });

  it('成功时带题目列表，与 parseSplitResult 结果一致（兼容旧调用）', () => {
    const raw = '[{"stem":"题一"},{"number":"3","stem":"题三"}]';
    const outcome = parseSplitResultDetailed(raw);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.questions).toEqual(parseSplitResult(raw));
  });
});

describe('parseSplitResultDetailed（json_object 对象外壳兼容）', () => {
  const items = '[{"number":"1","stem":"解方程 x+1=2"}]';

  it('提示词要求的 {"questions":[...]} 直接可用（回归：不再判 not_array）', () => {
    const outcome = parseSplitResultDetailed(`{"questions":${items}}`);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.questions[0]).toMatchObject({ number: '1', stem: '解方程 x+1=2' });
  });

  it('data / result / items / list 等外层键同样识别', () => {
    for (const key of ['data', 'result', 'items', 'list']) {
      expect(parseSplitResultDetailed(`{"${key}":${items}}`).ok, key).toBe(true);
    }
  });

  it('键名不认识但恰好只有一个数组值时兜底取用', () => {
    expect(parseSplitResultDetailed(`{"切题结果":${items}}`).ok).toBe(true);
  });

  it('对象里有两个数组且键名未知 → not_array（无法判定哪个是题目）', () => {
    expect(parseSplitResultDetailed('{"a":[1],"b":[2]}')).toEqual({ ok: false, reason: 'not_array' });
  });

  it('包装对象内空数组仍按 empty，缺题干仍按 no_stem', () => {
    expect(parseSplitResultDetailed('{"questions":[]}')).toEqual({ ok: false, reason: 'empty' });
    expect(parseSplitResultDetailed('{"questions":[{"type":"选择题"}]}')).toEqual({
      ok: false,
      reason: 'no_stem',
    });
  });

  it('裸数组继续支持（向后兼容）', () => {
    expect(parseSplitResultDetailed(items).ok).toBe(true);
  });
});

describe('buildSplitPrompt（与 response_format=json_object 对齐）', () => {
  const prompt = buildSplitPrompt();

  it('要求 {"questions":[...]} 对象外壳，不再要求顶层数组', () => {
    expect(prompt).toContain('{"questions"');
    expect(prompt).toContain('JSON');
    expect(prompt).not.toContain('只输出 JSON 数组');
  });
});

describe('classifyQuestions（本地分类，零 token）', () => {
  const q = (number: string, stem: string, answer?: string): PaperQuestion => ({ number, stem, answer });

  it('关键词命中各自归组', () => {
    const groups = classifyQuestions([
      q('1', '解方程时没有分类讨论 a 的取值'),
      q('2', '求函数的定义域'),
      q('3', '计算题：25+37'),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.code === 'case_miss')?.questions.map((x) => x.number)).toEqual(['1']);
    expect(groups.find((g) => g.code === 'hidden_cond')?.questions.map((x) => x.number)).toEqual(['2']);
    expect(groups.find((g) => g.code === 'calc_error')?.questions.map((x) => x.number)).toEqual(['3']);
  });

  it('无法归组进 general 共用一组', () => {
    const groups = classifyQuestions([q('1', '证明三角形全等'), q('2', '画圆')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].code).toBe('general');
    expect(groups[0].questions).toHaveLength(2);
  });

  it('answer 也参与匹配', () => {
    const groups = classifyQuestions([q('1', '解方程', '没讨论单位换算')]);
    expect(groups[0].code).toBe('unit_error');
  });
});

describe('buildGroupDiagnosePrompt（共享诊断提示词）', () => {
  it('有作答要求 L2 + 锚定，无作答要求 L1 不硬编错因', () => {
    const members = [{ number: '1', stem: '题干' }];
    const l2 = buildGroupDiagnosePrompt({ code: 'calc_error', representative: members[0], members, hasStudentAnswer: true });
    expect(l2).toContain('L2');
    expect(l2).toContain('锚定');
    expect(l2).toContain('错因 code');

    const l1 = buildGroupDiagnosePrompt({ code: 'general', representative: members[0], members, hasStudentAnswer: false });
    expect(l1).toContain('L1');
    expect(l1).toContain('不硬编错因');
  });
});
