import { describe, expect, it } from 'vitest';

import {
  DISCIPLINE_BLOCK,
  DISCIPLINE_BRIEF,
  SCOPE_BOUNDARY_LINE,
  buildDiagnoseSystemPrompt,
} from '@/lib/diagnose/prompts';
import { REFUSAL_PREFIX } from '@/lib/safety/messages';
import type { DiagnoseContext, DiagnoseState } from '@/lib/diagnose/types';

/**
 * 提示词契约用例：纯字符串断言，不调用真实模型。
 *
 * 锁死两条曾被改错、且改错后「看起来更严格、实际更没用」的口径：
 * 1. 第 1 条禁令必须是「不得只给答案」，不能退回「不得直接给答案」——后者会把正常
 *    讲解逼成憋着不给，学生说「这题不会」也拿不到完整求解；
 * 2. 学科边界是三级处置，REFUSAL_PREFIX 只有越权类硬拒能用。该前缀是 block-detect
 *    的豁免标记，泼到非数学 / 无关话题的软引导上会被误判成越权拒答。
 */
const ALL_STATES: DiagnoseState[] = [
  'intake',
  'clarify',
  'diagnose',
  'explain',
  'done',
  'L1_only',
  'reject',
];

const ctx = (state: DiagnoseState): DiagnoseContext => ({
  subject: 'math',
  state,
  clarifyUsed: 0,
  hintLevel: 1,
});

const completeness = {
  hasProblem: true,
  hasStudentAnswer: true,
  hasCorrectAnswer: false,
  hasAnalysis: false,
};

const promptOf = (state: DiagnoseState) =>
  buildDiagnoseSystemPrompt({ state, ctx: ctx(state), completeness });

describe('输出纪律：第 1 条禁令口径', () => {
  it('含「不得只给答案」，不含「不得直接给答案」', () => {
    expect(DISCIPLINE_BLOCK).toContain('不得只给答案');
    expect(DISCIPLINE_BLOCK).not.toContain('不得直接给答案');
  });

  it('明确允许推理阶段完整求解与先讲过程再给答案', () => {
    expect(DISCIPLINE_BLOCK).toContain('允许在推理阶段完整求解');
    expect(DISCIPLINE_BLOCK).toContain('先讲过程再给答案');
    expect(DISCIPLINE_BLOCK).toContain('这题不会');
    expect(DISCIPLINE_BLOCK).toContain('按正常讲解处理');
  });

  it('第 2 条仍是「不得整段复述正确解法」', () => {
    expect(DISCIPLINE_BLOCK).toContain('不得整段复述正确解法');
  });
});

describe('学科边界：三级处置结构', () => {
  const lines = SCOPE_BOUNDARY_LINE.split('\n');
  const escalation = lines.find((line) => line.startsWith('①')) ?? '';
  const otherSubject = lines.find((line) => line.startsWith('②')) ?? '';
  const offTopic = lines.find((line) => line.startsWith('③')) ?? '';

  it('恰好三级：越权类 / 非数学学科 / 无关话题', () => {
    expect(lines).toHaveLength(4); // 标题 + 三级
    expect(escalation).toContain('越权类');
    expect(otherSubject).toContain('非数学学科');
    expect(offTopic).toContain('无关');
  });

  it('只有越权类要求携带 REFUSAL_PREFIX', () => {
    expect(escalation).toContain(`以「${REFUSAL_PREFIX}」开头`);
    expect(escalation).not.toContain('不得带');
  });

  it('非数学学科走软引导：一句话说明「没有专门优化」，且不得带前缀', () => {
    expect(otherSubject).toContain('这类题我没有专门优化');
    expect(otherSubject).toContain('不得带');
    expect(otherSubject).toContain('不展开');
    expect(otherSubject).toContain('不给解法');
  });

  it('无关话题走软引导：同样不得带前缀，不纠缠', () => {
    expect(offTopic).toContain('不得带前缀');
    expect(offTopic).toContain('不纠缠');
  });

  it('三级里带前缀的只有越权类那一级（②③ 的引用属于禁令，不是要求携带）', () => {
    const mentions = lines.filter((line) => line.includes(REFUSAL_PREFIX));
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toBe(escalation);
    expect(offTopic.includes(REFUSAL_PREFIX)).toBe(false);
  });
});

/**
 * 收尾态（done）只负责一句话结束，不再重复整块输出纪律——这是设计取舍，不是缺口：
 * 该态已拿到学生的「明白了/不用了」，再补一遍禁令只会多一层说教。边界条款仍保留，
 * 因为学生可能在收尾轮突然抛出越权或非数学请求。
 */
const NO_DISCIPLINE_STATES: DiagnoseState[] = ['done'];

describe('七个状态的提示词按态装配', () => {
  it('每个状态都带边界要点（越权/非数学/无关，前缀只给硬拒）', () => {
    for (const state of ALL_STATES) {
      const prompt = promptOf(state);
      if (prompt === null) continue;
      expect(prompt, `状态 ${state} 缺少边界条款`).toContain('只做数学错题诊断');
      expect(prompt, `状态 ${state} 缺少越权类处置`).toContain('越权');
      expect(prompt, `状态 ${state} 缺少非数学学科处置`).toContain('非数学学科');
      expect(prompt, `状态 ${state} 缺少无关话题处置`).toContain('无关');
      expect(prompt, `状态 ${state} 的软引导丢失前缀禁令`).toContain('不得带');
      expect(prompt, `状态 ${state} 的禁令退回旧口径`).not.toContain('不得直接给答案');
    }
  });

  it('除收尾态外，每个状态都保留三条禁令的判据', () => {
    for (const state of ALL_STATES) {
      if (NO_DISCIPLINE_STATES.includes(state)) continue;
      const prompt = promptOf(state);
      if (prompt === null) continue;
      expect(prompt, `状态 ${state} 缺少输出纪律`).toContain('不得只给答案');
      expect(prompt, `状态 ${state} 失去不复述解法的约束`).toContain('不得整段复述正确解法');
    }
  });

  it('收尾态只留最小边界，不重复纪律块', () => {
    const prompt = promptOf('done');
    expect(prompt).not.toBeNull();
    expect(prompt).toContain('只做数学错题诊断');
    expect(prompt).not.toContain(DISCIPLINE_BLOCK);
    expect(prompt).not.toContain(DISCIPLINE_BRIEF);
  });

  it('片段按需装配：低阶态不注入后续阶段的策略卡与归因指引', () => {
    const intake = promptOf('intake') ?? '';
    expect(intake).not.toContain('策略卡表');
    expect(intake).not.toContain('表现 → 错因');
    const clarify = promptOf('clarify') ?? '';
    expect(clarify).not.toContain('策略卡表');
    const diagnose = promptOf('diagnose') ?? '';
    expect(diagnose).toContain('策略卡表');
    expect(diagnose).toContain('表现 → 错因');
  });

  it('同一条禁令在单个提示词里只出现一次', () => {
    const diagnose = promptOf('diagnose') ?? '';
    expect(diagnose.split('不得整段复述正确解法')).toHaveLength(2);
    const intake = promptOf('intake') ?? '';
    expect(intake.split('hints 一律省略')).toHaveLength(2);
  });

  it('篇幅预算：按态裁剪后的长度不得回涨', () => {
    const budget: Record<DiagnoseState, number> = {
      intake: 1600,
      clarify: 1100,
      diagnose: 2700,
      explain: 950,
      L1_only: 1250,
      reject: 470,
      done: 180,
    };
    let total = 0;
    let counted = 0;
    for (const state of ALL_STATES) {
      const prompt = promptOf(state);
      if (prompt === null) continue;
      expect(
        prompt.length,
        `状态 ${state} 提示词 ${prompt.length} 字符，超预算 ${budget[state]}`,
      ).toBeLessThanOrEqual(budget[state]);
      total += prompt.length;
      counted += 1;
    }
    expect(Math.round(total / counted), '七态平均篇幅超预算').toBeLessThanOrEqual(1150);
  });
});
