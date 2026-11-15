import { describe, expect, it } from 'vitest';
import { createSubmissionStore, createSubmitDiagnosisTool } from '../../../lib/tools/builtin/submit_diagnosis.ts';
import { validateArguments } from '../../../lib/tools/validate.ts';

/**
 * submit_diagnosis schema 回归（P3）：提示词要求模型填 completeness 四布尔，
 * schema 必须声明同名字段，否则模型只能自造 hasOptions / hasReferenceAnswer 塞进 notes。
 */
describe('submit_diagnosis inputSchema：completeness 口径', () => {
  const schema = createSubmitDiagnosisTool(createSubmissionStore()).inputSchema;
  const base = { level: 'L1', knowledgePoints: ['长方形周长'] };
  const full = { hasProblem: true, hasStudentAnswer: false, hasCorrectAnswer: false, hasAnalysis: false };

  it('四布尔齐全 → 参数校验通过', () => {
    const result = validateArguments(schema, { ...base, completeness: full });
    expect(result.valid).toBe(true);
  });

  it('缺一个布尔 → 参数校验失败', () => {
    const result = validateArguments(schema, {
      ...base,
      completeness: { hasProblem: true, hasStudentAnswer: false, hasCorrectAnswer: false },
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.join('；')).toContain('hasAnalysis');
  });

  it('completeness 缺省 → 通过（不加入顶层 required）；非布尔值 → 失败', () => {
    expect(validateArguments(schema, base).valid).toBe(true);
    const bad = validateArguments(schema, { ...base, completeness: { ...full, hasAnalysis: 'yes' } });
    expect(bad.valid).toBe(false);
  });

  it('errorCause 允许字面 null（L1 常态），也允许对象；字符串仍拒绝', () => {
    expect(validateArguments(schema, { ...base, errorCause: null }).valid).toBe(true);
    expect(
      validateArguments(schema, { ...base, errorCause: { code: 'hidden_cond', confidence: 0.8 } }).valid,
    ).toBe(true);
    expect(validateArguments(schema, { ...base, errorCause: 'hidden_cond' }).valid).toBe(false);
  });

  it('schema 与提示词字段名一致：properties 含 completeness 四键', () => {
    const completeness = schema.properties?.completeness;
    expect(completeness?.required).toEqual([
      'hasProblem',
      'hasStudentAnswer',
      'hasCorrectAnswer',
      'hasAnalysis',
    ]);
    expect(Object.keys(completeness?.properties ?? {}).sort()).toEqual([
      'hasAnalysis',
      'hasCorrectAnswer',
      'hasProblem',
      'hasStudentAnswer',
    ]);
    expect(schema.required ?? []).not.toContain('completeness');
  });
});
