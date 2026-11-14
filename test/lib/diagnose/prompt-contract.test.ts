import { describe, expect, it } from 'vitest';

import {
  DISCIPLINE_BLOCK,
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

describe('七个状态的提示词都注入纪律与边界', () => {
  it('每个有诊断提示词的状态都带 SCOPE_BOUNDARY_LINE', () => {
    let built = 0;
    for (const state of ALL_STATES) {
      const prompt = promptOf(state);
      if (prompt === null) continue; // 非诊断态不注入
      built += 1;
      expect(prompt, `状态 ${state} 缺少学科边界`).toContain(SCOPE_BOUNDARY_LINE);
      expect(prompt, `状态 ${state} 的禁令退回旧口径`).not.toContain('不得直接给答案');
    }
    expect(built).toBeGreaterThanOrEqual(6);
  });

  it('除收尾态外，每个状态都带完整 DISCIPLINE_BLOCK', () => {
    for (const state of ALL_STATES) {
      const prompt = promptOf(state);
      if (prompt === null) continue;
      if (NO_DISCIPLINE_STATES.includes(state)) {
        expect(prompt, `收尾态 ${state} 也应保留边界`).toContain(SCOPE_BOUNDARY_LINE);
        continue;
      }
      expect(prompt, `状态 ${state} 缺少输出纪律`).toContain(DISCIPLINE_BLOCK);
    }
  });
});
