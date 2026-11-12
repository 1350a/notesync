import { describe, expect, it } from 'vitest';
import { sanitizeMessages } from '../../../lib/history/sanitize.ts';

/** 构造一条最小可用的 assistant 消息，再按需覆盖结构化字段 */
function wrapAssistant(extra: Record<string, unknown>): Record<string, unknown> {
  return { role: 'assistant', content: '结论', ...extra };
}

describe('历史回读的结构化字段清洗', () => {
  describe('awaitingQuestions', () => {
    it('合法问题保留，label 与 options 原样透出', () => {
      const out = sanitizeMessages([
        wrapAssistant({
          awaitingQuestions: [
            { label: '身份确认', question: '你是自己做的吗？', options: ['是', '不是'] },
          ],
        }),
      ]);
      expect(out[0].awaitingQuestions).toEqual([
        { label: '身份确认', question: '你是自己做的吗？', options: ['是', '不是'] },
      ]);
    });

    it('question 缺失或非字符串的条目整条丢弃，其余保留', () => {
      const out = sanitizeMessages([
        wrapAssistant({
          awaitingQuestions: [
            { question: 123 },
            { label: '只有标签' },
            { question: '保留我' },
          ],
        }),
      ]);
      expect(out[0].awaitingQuestions).toEqual([{ question: '保留我' }]);
    });

    it('options 里的非字符串项被过滤，剩余为空则不设该字段', () => {
      const out = sanitizeMessages([
        wrapAssistant({
          awaitingQuestions: [{ question: '选一个', options: [1, null, '', '   '] }],
        }),
      ]);
      expect(out[0].awaitingQuestions).toEqual([{ question: '选一个' }]);
    });

    it('全部条目非法时不写字段', () => {
      const out = sanitizeMessages([
        wrapAssistant({ awaitingQuestions: [{ question: '' }, null, 'x'] }),
      ]);
      expect(out[0].awaitingQuestions).toBeUndefined();
    });
  });

  describe('diagnosis', () => {
    const validDiagnosis = {
      subject: 'math',
      level: 'L2',
      completeness: {
        hasProblem: true,
        hasStudentAnswer: true,
        hasCorrectAnswer: false,
        hasAnalysis: false,
      },
      knowledgePoints: ['判别式', '求根公式'],
      errorCause: { code: 'formula_misuse', confidence: 0.82 },
      strategy: {
        errorCode: 'formula_misuse',
        id: 'formula_misuse_v1',
        steps: ['核对公式', '再代数'],
        subject: 'math',
        version: 1,
      },
      hints: [{ level: 1, content: '先看符号' }],
      strategyVersion: 1,
    };

    it('合法结论按已知形状回读', () => {
      const out = sanitizeMessages([wrapAssistant({ diagnosis: validDiagnosis })]);
      expect(out[0].diagnosis).toMatchObject({
        subject: 'math',
        level: 'L2',
        knowledgePoints: ['判别式', '求根公式'],
        errorCause: { code: 'formula_misuse', confidence: 0.82 },
        hints: [{ level: 1, content: '先看符号' }],
        strategyVersion: 1,
      });
      expect(out[0].diagnosis?.strategy?.id).toBe('formula_misuse_v1');
    });

    it('level 非法时整条丢弃', () => {
      const out = sanitizeMessages([
        wrapAssistant({ diagnosis: { ...validDiagnosis, level: 'L9' } }),
      ]);
      expect(out[0].diagnosis).toBeUndefined();
    });

    it('非对象 diagnosis 不写字段', () => {
      const out = sanitizeMessages([wrapAssistant({ diagnosis: 'oops' })]);
      expect(out[0].diagnosis).toBeUndefined();
    });

    it('未知错因 code 回落为 null，confidence 收敛到 0~1', () => {
      const out = sanitizeMessages([
        wrapAssistant({
          diagnosis: {
            ...validDiagnosis,
            errorCause: { code: 'not_a_code', confidence: 0.9 },
            secondaryErrorCause: { code: 'calc_error', confidence: 3 },
          },
        }),
      ]);
      expect(out[0].diagnosis?.errorCause).toBeNull();
      expect(out[0].diagnosis?.secondaryErrorCause).toEqual({
        code: 'calc_error',
        confidence: 1,
      });
    });

    it('策略卡 errorCode 非法或 steps 为空时回落为 null', () => {
      const badCode = sanitizeMessages([
        wrapAssistant({
          diagnosis: {
            ...validDiagnosis,
            strategy: { ...validDiagnosis.strategy, errorCode: 'nope' },
          },
        }),
      ]);
      expect(badCode[0].diagnosis?.strategy).toBeNull();

      const noSteps = sanitizeMessages([
        wrapAssistant({
          diagnosis: { ...validDiagnosis, strategy: { ...validDiagnosis.strategy, steps: [] } },
        }),
      ]);
      expect(noSteps[0].diagnosis?.strategy).toBeNull();
    });

    it('hints 里 level 非法或 content 为空的项被丢弃', () => {
      const out = sanitizeMessages([
        wrapAssistant({
          diagnosis: {
            ...validDiagnosis,
            hints: [{ level: 4, content: 'x' }, { level: 2, content: '  ' }, { level: 3, content: '关键步骤' }],
          },
        }),
      ]);
      expect(out[0].diagnosis?.hints).toEqual([{ level: 3, content: '关键步骤' }]);
    });

    it('knowledgePoints 超量与超长均被截断', () => {
      const out = sanitizeMessages([
        wrapAssistant({
          diagnosis: {
            ...validDiagnosis,
            knowledgePoints: ['a'.repeat(80), 'b', 'c', 'd'],
          },
        }),
      ]);
      expect(out[0].diagnosis?.knowledgePoints).toHaveLength(3);
      expect(out[0].diagnosis?.knowledgePoints[0]).toHaveLength(40);
    });

    it('completeness 非布尔值一律按 false', () => {
      const out = sanitizeMessages([
        wrapAssistant({
          diagnosis: {
            ...validDiagnosis,
            completeness: { hasProblem: 'yes', hasStudentAnswer: 1 },
          },
        }),
      ]);
      expect(out[0].diagnosis?.completeness).toEqual({
        hasProblem: false,
        hasStudentAnswer: false,
        hasCorrectAnswer: false,
        hasAnalysis: false,
      });
    });
  });
});
