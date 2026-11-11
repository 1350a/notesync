import { describe, expect, it } from 'vitest';
import {
  advanceAfterResponse,
  buildDiagnosisResult,
  buildVerifyEvidence,
  collectStudentSources,
  CONFIDENCE_THRESHOLD,
  finalizeDiagnosis,
  parseDiagnoseContext,
  parseDiagnoseEvent,
  parseSubmission,
  resolveDiagnoseSession,
  resolveOutcome,
  type LoopRunResult,
  type ParsedSubmission,
} from '../../../lib/diagnose/runtime.ts';
import { createInitialContext } from '../../../lib/diagnose/state-machine.ts';
import type { DiagnoseAttachment, DiagnoseContext, DiagnosisCompleteness } from '../../../lib/diagnose/types.ts';

const FULL: DiagnosisCompleteness = {
  hasProblem: true,
  hasStudentAnswer: true,
  hasCorrectAnswer: true,
  hasAnalysis: true,
};

function context(partial: Partial<DiagnoseContext>): DiagnoseContext {
  return { ...createInitialContext(), ...partial };
}

describe('payload 严格解析', () => {
  it('合法上下文通过，任一字段脏数据整体拒绝', () => {
    expect(parseDiagnoseContext({ subject: 'math', state: 'explain', clarifyUsed: 2, hintLevel: 3 })).not.toBeNull();
    expect(parseDiagnoseContext({ subject: 'english', state: 'intake', clarifyUsed: 0, hintLevel: 1 })).toBeNull();
    expect(parseDiagnoseContext({ subject: 'math', state: '飞', clarifyUsed: 0, hintLevel: 1 })).toBeNull();
    expect(parseDiagnoseContext({ subject: 'math', state: 'intake', clarifyUsed: 9, hintLevel: 1 })).toBeNull();
    expect(parseDiagnoseContext(null)).toBeNull();
  });

  it('事件白名单：四类放行，伪造服务端事件拒绝', () => {
    expect(parseDiagnoseEvent({ type: 'clarify_done', hasAnswer: true, refused: false })).not.toBeNull();
    expect(parseDiagnoseEvent({ type: 'hint_descend' })).not.toBeNull();
    expect(parseDiagnoseEvent({ type: 'mastered' })).not.toBeNull();
    expect(parseDiagnoseEvent({ type: 'user_stop' })).not.toBeNull();
    expect(parseDiagnoseEvent({ type: 'intake_done', hasProblem: true, isMath: true })).toBeNull();
    expect(parseDiagnoseEvent({ type: 'clarify_done', hasAnswer: 'yes' })).toBeNull();
  });

  it('resolveDiagnoseSession：非对象不激活；脏上下文回落 intake；合法事件即时应用', () => {
    expect(resolveDiagnoseSession(undefined, [])).toBeNull();
    expect(resolveDiagnoseSession('x', [])).toBeNull();

    const dirty = resolveDiagnoseSession({ context: { state: 'hacked' } }, []);
    expect(dirty?.context.state).toBe('intake');

    const advanced = resolveDiagnoseSession(
      {
        context: { subject: 'math', state: 'explain', clarifyUsed: 2, hintLevel: 1 },
        event: { type: 'hint_descend' },
      },
      [],
    );
    expect(advanced?.context.state).toBe('explain');
    expect(advanced?.context.hintLevel).toBe(2);

    // 与状态不匹配的事件被忽略，不报错
    const mismatch = resolveDiagnoseSession(
      {
        context: { subject: 'math', state: 'done', clarifyUsed: 0, hintLevel: 1 },
        event: { type: 'mastered' },
      },
      [],
    );
    expect(mismatch?.context.state).toBe('done');
  });

  it('完整度由附件推导', () => {
    const session = resolveDiagnoseSession(
      {},
      [
        { name: '题.txt', category: 'origin', text: '题' },
        { name: '答.txt', category: 'wrong', text: '答' },
      ],
    );
    expect(session?.completeness).toEqual({
      hasProblem: true,
      hasStudentAnswer: true,
      hasCorrectAnswer: false,
      hasAnalysis: false,
    });
  });
});

describe('parseSubmission / buildDiagnosisResult', () => {
  const l2 = {
    level: 'L2',
    knowledgePoints: ['二次方程'],
    errorCause: { code: 'hidden_cond', confidence: 0.82 },
    hints: [{ level: 1, content: '考定义域。' }],
  };

  it('L2 合法提交通过，策略卡由服务端注入', () => {
    const parsed = parseSubmission(l2);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = buildDiagnosisResult(parsed.value, FULL);
    expect(result.strategy?.errorCode).toBe('hidden_cond');
    expect(result.errorCause?.confidence).toBe(0.82);
  });

  it('未知 code / L2 无主错因 / L1 带错因 → 拒绝', () => {
    expect(parseSubmission({ ...l2, errorCause: { code: 'made_up', confidence: 0.9 } }).ok).toBe(false);
    expect(parseSubmission({ level: 'L2', knowledgePoints: ['x'] }).ok).toBe(false);
    expect(
      parseSubmission({ level: 'L1', knowledgePoints: ['x'], errorCause: { code: 'misread', confidence: 0.9 } }).ok,
    ).toBe(false);
  });

  it('L1 合法：errorCause 为空、strategy 为 null', () => {
    const parsed = parseSubmission({ level: 'L1', knowledgePoints: ['函数'], notes: '未提供作答' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = buildDiagnosisResult(parsed.value, FULL);
    expect(result.errorCause).toBeNull();
    expect(result.strategy).toBeNull();
    expect(result.notes).toBe('未提供作答');
  });
});

describe('resolveOutcome / advanceAfterResponse 推进矩阵', () => {
  const submit = (over: Partial<ParsedSubmission> = {}): ParsedSubmission => ({
    isMath: true,
    level: 'L2',
    knowledgePoints: ['x'],
    errorCause: { code: 'misread', confidence: 0.9 },
    hints: [],
    ...over,
  });

  it('intake + 非数学 → reject → done', () => {
    const ctx = advanceAfterResponse({
      context: context({ state: 'intake' }),
      completeness: FULL,
      submission: submit({ isMath: false, level: 'L1', errorCause: null }),
      outcome: 'l1_fallback',
    });
    expect(ctx.state).toBe('done');
  });

  it('intake + 数学 + 无作答 → clarify（预扣 1）；有作答 → 快进 diagnose', () => {
    const noAnswer = advanceAfterResponse({
      context: context({ state: 'intake' }),
      completeness: { ...FULL, hasStudentAnswer: false },
      submission: submit({ level: 'L1', errorCause: null }),
      outcome: 'l1_fallback',
    });
    expect(noAnswer.state).toBe('clarify');
    expect(noAnswer.clarifyUsed).toBe(1);

    const withAnswer = advanceAfterResponse({
      context: context({ state: 'intake' }),
      completeness: FULL,
      submission: submit(),
      outcome: 'confident',
    });
    expect(withAnswer.state).toBe('diagnose');
  });

  it('intake + 无原题 → 留在 intake 引导', () => {
    const ctx = advanceAfterResponse({
      context: context({ state: 'intake' }),
      completeness: { ...FULL, hasProblem: false },
      submission: submit({ level: 'L1', errorCause: null }),
      outcome: 'l1_fallback',
    });
    expect(ctx.state).toBe('intake');
  });

  it('diagnose：confident → explain；low_confidence 预算有余 → clarify；guard_failed → L1_only 待下轮', () => {
    expect(
      advanceAfterResponse({ context: context({ state: 'diagnose' }), completeness: FULL, submission: submit(), outcome: 'confident' }).state,
    ).toBe('explain');
    expect(
      advanceAfterResponse({ context: context({ state: 'diagnose', clarifyUsed: 1 }), completeness: FULL, submission: submit({ errorCause: { code: 'misread', confidence: 0.3 } }), outcome: 'low_confidence' }).state,
    ).toBe('clarify');
    const degraded = advanceAfterResponse({
      context: context({ state: 'diagnose', clarifyUsed: 2 }),
      completeness: FULL,
      submission: submit({ errorCause: { code: 'misread', confidence: 0.3 } }),
      outcome: 'low_confidence',
    });
    expect(degraded.state).toBe('explain');
    expect(
      advanceAfterResponse({ context: context({ state: 'diagnose' }), completeness: FULL, submission: submit(), outcome: 'guard_failed' }).state,
    ).toBe('L1_only');
  });

  it('diagnose + 模型自行 L1（l1_fallback）→ L1_only → done 一步走完', () => {
    const ctx = advanceAfterResponse({
      context: context({ state: 'diagnose' }),
      completeness: FULL,
      submission: submit({ level: 'L1', errorCause: null, notes: '未辨认出作答' }),
      outcome: 'l1_fallback',
    });
    expect(ctx.state).toBe('done');
  });

  it('L1_only / reject 提交后收尾到 done；explain 不动', () => {
    expect(
      advanceAfterResponse({ context: context({ state: 'L1_only' }), completeness: FULL, submission: submit({ level: 'L1', errorCause: null }), outcome: 'l1_fallback' }).state,
    ).toBe('done');
    expect(
      advanceAfterResponse({ context: context({ state: 'explain', hintLevel: 2 }), completeness: FULL, submission: submit(), outcome: 'confident' }).state,
    ).toBe('explain');
  });

  it('resolveOutcome 阈值分界', () => {
    expect(resolveOutcome(submit(), true)).toBe('confident');
    expect(resolveOutcome(submit({ errorCause: { code: 'misread', confidence: CONFIDENCE_THRESHOLD - 0.01 } }), true)).toBe('low_confidence');
    expect(resolveOutcome(submit(), false)).toBe('guard_failed');
    expect(resolveOutcome(submit({ level: 'L1', errorCause: null }), true)).toBe('l1_fallback');
  });
});

describe('证据与来源收集', () => {
  const attachments: DiagnoseAttachment[] = [
    { name: '题目.txt', category: 'origin', text: '解方程' },
    { name: '作答.txt', category: 'wrong', text: 'x=2' },
    { name: '答案.txt', category: 'correct', text: 'x=±2' },
  ];

  it('wrong 附件 + 最新用户文本都进来源', () => {
    expect(collectStudentSources(attachments, ' 我写的是 x=2 ')).toEqual(['x=2', '我写的是 x=2']);
  });

  it('机械判定证据：漏解场景产出 not_equivalent 文本；缺正确答案为空', () => {
    const evidence = buildVerifyEvidence(attachments);
    expect(evidence).toContain('不等');
    expect(evidence).toContain('机械判定');
    expect(buildVerifyEvidence(attachments.slice(0, 2))).toBe('');
  });
});

describe('finalizeDiagnosis 编排', () => {
  const attachments: DiagnoseAttachment[] = [
    { name: '题目.png', category: 'origin', text: '解方程 x^2=4' },
    { name: '作答.png', category: 'wrong', text: 'x=2' },
  ];
  const baseMessages = [{ role: 'system' as const, content: '诊断提示词' }, { role: 'user' as const, content: '题面' }];
  const doneRun = (outputText: string): LoopRunResult => ({
    outputText,
    done: { usedRounds: 1, finishReason: 'stop' },
    awaitingUser: false,
    failed: false,
  });

  it('缺提交自动补一次重试（submission），拿到提交即组装', async () => {
    const store: { args: Record<string, unknown> | null } = { args: null };
    let calls = 0;
    const fin = await finalizeDiagnosis({
      session: { context: context({ state: 'intake' }), completeness: FULL },
      baseMessages,
      mainRun: doneRun('L1 画像正文'),
      attachments,
      submissionStore: store,
      lastUserText: '',
      runLoop: async () => {
        calls += 1;
        store.args = { level: 'L1', knowledgePoints: ['二次方程'], notes: '首次未提交，补交' };
        return doneRun('（补交段）');
      },
    });
    expect(calls).toBe(1);
    expect(fin.retried).toBe('submission');
    expect(fin.diagnosis?.level).toBe('L1');
    expect(fin.context.state).toBe('diagnose'); // intake + 有作答快进
  });

  it('guard 两试不过：不交付 L2，上下文降级 L1_only', async () => {
    const store = { args: null as Record<string, unknown> | null };
    const sources = collectStudentSources(attachments, '');
    expect(sources.length).toBeGreaterThan(0);
    // 输出完全不引用作答 → guard 必败
    const unrelated = '这道题考一元二次方程的解法，先用因式分解，再……';
    let retried = false;
    const fin = await finalizeDiagnosis({
      session: { context: context({ state: 'diagnose' }), completeness: FULL },
      baseMessages,
      mainRun: doneRun(unrelated),
      attachments,
      submissionStore: store,
      lastUserText: '',
      runLoop: async () => {
        retried = true;
        store.args = {
          level: 'L2',
          knowledgePoints: ['二次方程'],
          errorCause: { code: 'case_miss', confidence: 0.9 },
        };
        return doneRun('（重试仍未引用）');
      },
    });
    // 主循环没有提交时先触发 submission 重试，其中已带上提交；guard 再试一次
    expect(retried).toBe(true);
    expect(fin.guardPassed).toBe(false);
    expect(fin.diagnosis).toBeNull();
    expect(fin.context.state).toBe('L1_only');
  });

  it('guard 首查通过：直接交付，无重试调用', async () => {
    const store = {
      args: {
        level: 'L2',
        knowledgePoints: ['二次方程'],
        errorCause: { code: 'case_miss', confidence: 0.9 },
      } as Record<string, unknown>,
    };
    let calls = 0;
    const fin = await finalizeDiagnosis({
      session: { context: context({ state: 'diagnose' }), completeness: FULL },
      baseMessages,
      mainRun: doneRun('你写到 x=2 就停了，另一个根哪去了？'),
      attachments,
      submissionStore: store,
      lastUserText: '',
      runLoop: async () => {
        calls += 1;
        return doneRun('');
      },
    });
    expect(calls).toBe(0);
    expect(fin.diagnosis?.errorCause?.code).toBe('case_miss');
    expect(fin.diagnosis?.strategy?.errorCode).toBe('case_miss');
    expect(fin.context.state).toBe('explain');
    expect(fin.guardPassed).toBe(true);
  });

  it('两轮都不提交：无诊断交付，上下文原地', async () => {
    const fin = await finalizeDiagnosis({
      session: { context: context({ state: 'intake' }), completeness: FULL },
      baseMessages,
      mainRun: doneRun('讲了一堆但没交表'),
      attachments,
      submissionStore: { args: null },
      lastUserText: '',
      runLoop: async () => doneRun('仍未交'),
    });
    expect(fin.diagnosis).toBeNull();
    expect(fin.context.state).toBe('intake');
  });
});
