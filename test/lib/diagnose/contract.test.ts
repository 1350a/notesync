import { describe, expect, it } from 'vitest';
import { ERROR_CAUSES, findErrorCause, isKnownErrorCode } from '../../../lib/diagnose/error-causes.ts';
import { findStrategyCard, STRATEGY_CARDS, STRATEGY_VERSION } from '../../../lib/diagnose/strategies.ts';
import { deriveCompleteness, resolveDiagnosisLevel } from '../../../lib/diagnose/completeness.ts';
import type { DiagnosisResult } from '../../../lib/diagnose/types.ts';

describe('错因表 × 策略卡一对一（diagnosis-model.md §8）', () => {
  it('错因 14 条', () => {
    expect(ERROR_CAUSES).toHaveLength(14);
  });

  it('每个错因 code 都有策略卡，且 errorCode 双向一致', () => {
    for (const cause of ERROR_CAUSES) {
      const card = findStrategyCard(cause.code);
      expect(card.errorCode).toBe(cause.code);
      expect(card.id).toBe(cause.code);
      expect(STRATEGY_CARDS[cause.code]).toBe(card);
    }
  });

  it('策略卡无多余条目', () => {
    expect(Object.keys(STRATEGY_CARDS)).toHaveLength(ERROR_CAUSES.length);
  });

  it('每张卡 2~5 条步骤、subject 为 math、版本对齐', () => {
    for (const card of Object.values(STRATEGY_CARDS)) {
      expect(card.steps.length).toBeGreaterThanOrEqual(2);
      expect(card.steps.length).toBeLessThanOrEqual(5);
      expect(card.subject).toBe('math');
      expect(card.version).toBe(STRATEGY_VERSION);
    }
  });

  it('未知 code 查询返回 null / 守卫拒绝', () => {
    expect(findErrorCause('made_up')).toBeNull();
    expect(isKnownErrorCode('made_up')).toBe(false);
    expect(isKnownErrorCode('calc_error')).toBe(true);
  });
});

describe('完整度推导（diagnosis-model.md §1.2 注）', () => {
  it('四类标签各自点亮对应布尔', () => {
    const c = deriveCompleteness([
      { category: 'origin', text: '解方程 x^2=4' },
      { category: 'wrong', text: 'x=2' },
      { category: 'correct', text: 'x=±2' },
      { category: 'analysis', text: '开方需取正负两根' },
    ]);
    expect(c).toEqual({ hasProblem: true, hasStudentAnswer: true, hasCorrectAnswer: true, hasAnalysis: true });
  });

  it('空内容附件不计入完整度', () => {
    const c = deriveCompleteness([
      { category: 'origin', text: '  ' },
      { category: 'wrong', text: '' },
      { category: 'origin', dataUrl: 'data:image/png;base64,xxx' },
    ]);
    expect(c.hasProblem).toBe(true);
    expect(c.hasStudentAnswer).toBe(false);
  });

  it('判级：仅原题 L1，有作答 L2，解析有无不影响', () => {
    expect(resolveDiagnosisLevel(deriveCompleteness([{ category: 'origin', text: '题' }]))).toBe('L1');
    expect(
      resolveDiagnosisLevel(
        deriveCompleteness([
          { category: 'origin', text: '题' },
          { category: 'wrong', text: '答' },
          { category: 'analysis', text: '解析' },
        ]),
      ),
    ).toBe('L2');
  });
});

describe('DiagnosisResult 形状（接口形状硬项，防字段漂移）', () => {
  it('L1 结果：errorCause/strategy 为 null，notes 声明', () => {
    const result: DiagnosisResult = {
      subject: 'math',
      level: 'L1',
      completeness: deriveCompleteness([{ category: 'origin', text: '题' }]),
      knowledgePoints: ['一元二次方程'],
      errorCause: null,
      strategy: null,
      hints: [],
      notes: '未提供作答，本次不做错因归因。',
      strategyVersion: STRATEGY_VERSION,
    };
    expect(result.errorCause).toBeNull();
    expect(result.strategy).toBeNull();
  });

  it('L2 结果：主错因带置信度，策略卡按 code 直查注入', () => {
    const result: DiagnosisResult = {
      subject: 'math',
      level: 'L2',
      completeness: deriveCompleteness([
        { category: 'origin', text: '题' },
        { category: 'wrong', text: '答' },
      ]),
      knowledgePoints: ['判别式'],
      errorCause: { code: 'hidden_cond', confidence: 0.8 },
      secondaryErrorCause: { code: 'calc_error', confidence: 0.3 },
      strategy: findStrategyCard('hidden_cond'),
      hints: [{ level: 1, content: '这题考隐含条件。' }],
      strategyVersion: STRATEGY_VERSION,
    };
    expect(result.strategy?.errorCode).toBe('hidden_cond');
  });
});
