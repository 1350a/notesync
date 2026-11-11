/**
 * 诊断状态机（纯函数，不碰网络）
 *
 * 契约来源：wip-agent-workflow.md §2 迁移表，7 状态版（strategize 并入 diagnose）。
 * 机器只认事件不认历史：route.ts 编排时逐事件驱动，前端随请求上送 DiagnoseContext。
 * 状态数量与预算为 D 级约束，实测可调；「有显式状态 + 有追问预算 + 有终止条件」三点不可丢。
 */
import type { DiagnoseContext, DiagnoseEvent } from './types.ts';

/** 追问预算：初始补问与置信度回炉同计，耗尽强制收敛（wip-agent-workflow.md §4.1，D 级可调） */
export const CLARIFY_BUDGET = 2;

/** 迁移结果：事件与当前状态不合法时 accepted=false 且 context 原样返回，调用方按兵不动而非报错 */
export interface TransitionOutcome {
  accepted: boolean;
  context: DiagnoseContext;
}

/** 初始上下文工厂；返回新对象而非共享常量，避免调用方误改单例 */
export function createInitialContext(subject: DiagnoseContext['subject'] = 'math'): DiagnoseContext {
  return { subject, state: 'intake', clarifyUsed: 0, hintLevel: 1 };
}

/** 阶梯下降查表；避免字面量联合做加法后拓宽成 number */
const DESCEND: Record<1 | 2, 2 | 3> = { 1: 2, 2: 3 };

function toDone(ctx: DiagnoseContext): TransitionOutcome {
  return { accepted: true, context: { ...ctx, state: 'done' } };
}

export function transition(ctx: DiagnoseContext, event: DiagnoseEvent): TransitionOutcome {
  const rejected: TransitionOutcome = { accepted: false, context: ctx };

  switch (ctx.state) {
    case 'intake': {
      if (event.type === 'user_stop') return toDone(ctx);
      if (event.type !== 'intake_done') return rejected;
      // 无原题连学科都判不了：留在 intake 引导补题（wip-diagnosis-model.md §1.1 必需项）
      if (!event.hasProblem) return { accepted: true, context: { ...ctx, state: 'intake' } };
      if (!event.isMath) return { accepted: true, context: { ...ctx, state: 'reject' } };
      // 进入 clarify 即发出第一轮补问（常见错法清单话术），预扣 1 次预算
      return { accepted: true, context: { ...ctx, state: 'clarify', clarifyUsed: 1 } };
    }

    case 'clarify': {
      if (event.type === 'user_stop') return toDone(ctx);
      if (event.type !== 'clarify_done') return rejected;
      if (event.hasAnswer) return { accepted: true, context: { ...ctx, state: 'diagnose' } };
      // 明确拒绝：直接降级 L1，不再浪费一轮追问（wip-diagnosis-model.md §2.2）
      if (event.refused) return { accepted: true, context: { ...ctx, state: 'L1_only' } };
      // 答了但没给出作答：预算未尽再问一轮（绑定可验证推测），耗尽强制收敛
      if (ctx.clarifyUsed >= CLARIFY_BUDGET) return { accepted: true, context: { ...ctx, state: 'L1_only' } };
      return { accepted: true, context: { ...ctx, state: 'clarify', clarifyUsed: ctx.clarifyUsed + 1 } };
    }

    case 'diagnose': {
      if (event.type === 'user_stop') return toDone(ctx);
      if (event.type !== 'diagnosis_done') return rejected;
      if (event.outcome === 'guard_failed') {
        // 作答引用判据两试不过：降级 L1，不硬编错因（wip-diagnosis-model.md §7.3）
        return { accepted: true, context: { ...ctx, state: 'L1_only' } };
      }
      if (event.outcome === 'confident') {
        return { accepted: true, context: { ...ctx, state: 'explain', hintLevel: 1 } };
      }
      // low_confidence：预算有余回 clarify 补问一次（可验证推测），耗尽走低置信输出仍进 explain
      if (ctx.clarifyUsed < CLARIFY_BUDGET) {
        return { accepted: true, context: { ...ctx, state: 'clarify', clarifyUsed: ctx.clarifyUsed + 1 } };
      }
      return { accepted: true, context: { ...ctx, state: 'explain', hintLevel: 1 } };
    }

    case 'explain': {
      if (event.type === 'user_stop') return toDone(ctx);
      if (event.type === 'mastered') return toDone(ctx);
      if (event.type === 'hint_descend') {
        // 已在 L3 不再降；完整解仅用户明确索取时由提示词层给出，不进阶梯
        const hintLevel = ctx.hintLevel === 3 ? 3 : DESCEND[ctx.hintLevel];
        return { accepted: true, context: { ...ctx, hintLevel } };
      }
      return rejected;
    }

    case 'L1_only':
    case 'reject': {
      if (event.type === 'user_stop') return toDone(ctx);
      if (event.type === 'output_done') return toDone(ctx);
      return rejected;
    }

    case 'done':
      // 终态：新一轮诊断由调用方用 createInitialContext 重开，不从 done 续
      return rejected;
  }
}
