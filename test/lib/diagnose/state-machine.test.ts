import { describe, expect, it } from 'vitest';
import { CLARIFY_BUDGET, createInitialContext, transition } from '../../../lib/diagnose/state-machine.ts';
import type { DiagnoseContext, DiagnoseEvent } from '../../../lib/diagnose/types.ts';

/** 走一遍事件序列，返回末次上下文；中途被拒不静默，直接失败 */
function run(ctx: DiagnoseContext, events: DiagnoseEvent[]): DiagnoseContext {
  let cur = ctx;
  for (const event of events) {
    const outcome = transition(cur, event);
    expect(outcome.accepted, `事件 ${event.type} 在 ${cur.state} 应被接受`).toBe(true);
    cur = outcome.context;
  }
  return cur;
}

describe('诊断状态机（wip-agent-workflow.md §2，7 状态版）', () => {
  it('主路径：intake→clarify→diagnose→explain→done', () => {
    const final = run(createInitialContext(), [
      { type: 'intake_done', hasProblem: true, isMath: true },
      { type: 'clarify_done', hasAnswer: true, refused: false },
      { type: 'diagnosis_done', outcome: 'confident' },
      { type: 'mastered' },
    ]);
    expect(final.state).toBe('done');
  });

  it('进入 clarify 预扣 1 次预算', () => {
    const { context } = transition(createInitialContext(), { type: 'intake_done', hasProblem: true, isMath: true });
    expect(context.state).toBe('clarify');
    expect(context.clarifyUsed).toBe(1);
  });

  it('无原题留在 intake 引导，不误入 reject', () => {
    const { context } = transition(createInitialContext(), { type: 'intake_done', hasProblem: false, isMath: true });
    expect(context.state).toBe('intake');
  });

  it('非数学题走 reject→done', () => {
    const final = run(createInitialContext(), [
      { type: 'intake_done', hasProblem: true, isMath: false },
      { type: 'output_done' },
    ]);
    expect(final.state).toBe('done');
  });

  it('明确拒绝补充：直接 L1_only，不再耗一轮追问', () => {
    const final = run(createInitialContext(), [
      { type: 'intake_done', hasProblem: true, isMath: true },
      { type: 'clarify_done', hasAnswer: false, refused: true },
    ]);
    expect(final.state).toBe('L1_only');
    expect(final.clarifyUsed).toBe(1);
  });

  it('答非所问：预算内再问一轮，耗尽强制 L1_only', () => {
    let ctx = run(createInitialContext(), [{ type: 'intake_done', hasProblem: true, isMath: true }]);
    ctx = run(ctx, [{ type: 'clarify_done', hasAnswer: false, refused: false }]);
    expect(ctx.state).toBe('clarify');
    expect(ctx.clarifyUsed).toBe(2);
    ctx = run(ctx, [{ type: 'clarify_done', hasAnswer: false, refused: false }]);
    expect(ctx.state).toBe('L1_only');
    expect(ctx.clarifyUsed).toBe(CLARIFY_BUDGET);
  });

  it('低置信且预算有余：回 clarify；预算耗尽：低置信输出仍进 explain', () => {
    // 入 clarify 已用 1 次，diagnose 低置信回炉 +1 → 2 次耗尽
    const ctx = run(createInitialContext(), [
      { type: 'intake_done', hasProblem: true, isMath: true },
      { type: 'clarify_done', hasAnswer: true, refused: false },
      { type: 'diagnosis_done', outcome: 'low_confidence' },
    ]);
    expect(ctx.state).toBe('clarify');
    expect(ctx.clarifyUsed).toBe(2);

    // 回炉拿到作答再诊断，仍低置信 → 无预算可回，走低置信 explain
    const final = run(ctx, [
      { type: 'clarify_done', hasAnswer: true, refused: false },
      { type: 'diagnosis_done', outcome: 'low_confidence' },
    ]);
    expect(final.state).toBe('explain');
  });

  it('guard 两试不过：diagnose 降级 L1_only（§7.3）', () => {
    const final = run(createInitialContext(), [
      { type: 'intake_done', hasProblem: true, isMath: true },
      { type: 'clarify_done', hasAnswer: true, refused: false },
      { type: 'diagnosis_done', outcome: 'guard_failed' },
    ]);
    expect(final.state).toBe('L1_only');
  });

  it('explain 阶梯逐级下降，L3 封底不再降', () => {
    let ctx = run(createInitialContext(), [
      { type: 'intake_done', hasProblem: true, isMath: true },
      { type: 'clarify_done', hasAnswer: true, refused: false },
      { type: 'diagnosis_done', outcome: 'confident' },
    ]);
    expect(ctx.hintLevel).toBe(1);
    ctx = run(ctx, [{ type: 'hint_descend' }, { type: 'hint_descend' }]);
    expect(ctx.hintLevel).toBe(3);
    ctx = run(ctx, [{ type: 'hint_descend' }]);
    expect(ctx.hintLevel).toBe(3);
    expect(ctx.state).toBe('explain');
  });

  it('explain 重入时阶梯复位到 L1（新的诊断输出从定位级开始）', () => {
    const ctx = run(createInitialContext(), [
      { type: 'intake_done', hasProblem: true, isMath: true },
      { type: 'clarify_done', hasAnswer: true, refused: false },
      { type: 'diagnosis_done', outcome: 'low_confidence' }, // 回炉
      { type: 'clarify_done', hasAnswer: true, refused: false },
      { type: 'diagnosis_done', outcome: 'confident' },
    ]);
    expect(ctx.hintLevel).toBe(1);
  });

  it('user_stop 在任意非终状态放行到 done', () => {
    for (const events of [
      [{ type: 'user_stop' }],
      [
        { type: 'intake_done', hasProblem: true, isMath: true },
        { type: 'user_stop' },
      ],
      [
        { type: 'intake_done', hasProblem: true, isMath: true },
        { type: 'clarify_done', hasAnswer: true, refused: false },
        { type: 'user_stop' },
      ],
    ] as DiagnoseEvent[][]) {
      const final = run(createInitialContext(), events);
      expect(final.state).toBe('done');
    }
  });

  it('非法事件被拒且上下文原样返回', () => {
    const ctx = createInitialContext();
    const outcome = transition(ctx, { type: 'mastered' });
    expect(outcome.accepted).toBe(false);
    expect(outcome.context).toBe(ctx);

    const inClarify = run(ctx, [{ type: 'intake_done', hasProblem: true, isMath: true }]);
    const bad = transition(inClarify, { type: 'intake_done', hasProblem: true, isMath: true });
    expect(bad.accepted).toBe(false);
    expect(bad.context).toBe(inClarify);
  });

  it('done 为终态，任何事件都拒绝', () => {
    const done = run(createInitialContext(), [{ type: 'user_stop' }]);
    expect(transition(done, { type: 'user_stop' }).accepted).toBe(false);
    expect(transition(done, { type: 'intake_done', hasProblem: true, isMath: true }).accepted).toBe(false);
  });

  it('迁移为纯函数：不修改传入上下文', () => {
    const ctx = createInitialContext();
    const snapshot = { ...ctx };
    transition(ctx, { type: 'intake_done', hasProblem: true, isMath: true });
    transition(ctx, { type: 'user_stop' });
    expect(ctx).toEqual(snapshot);
  });

  it('subject 字段全程保留（多学科预留）', () => {
    const final = run(createInitialContext(), [
      { type: 'intake_done', hasProblem: true, isMath: true },
      { type: 'clarify_done', hasAnswer: true, refused: false },
      { type: 'diagnosis_done', outcome: 'confident' },
      { type: 'mastered' },
    ]);
    expect(final.subject).toBe('math');
  });
});
