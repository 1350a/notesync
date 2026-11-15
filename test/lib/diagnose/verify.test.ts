import { describe, expect, it } from 'vitest';
import { verifyAnswerEquivalence } from '../../../lib/diagnose/verify.ts';

describe('verifyAnswerEquivalence（mathjs 确定性判定）', () => {
  it('小数与分数等价', () => {
    expect(verifyAnswerEquivalence('0.5', '1/2').verdict).toBe('equivalent');
  });

  it('外壳记法（x=、答：）不参与判定', () => {
    expect(verifyAnswerEquivalence('x=3', '答：3').verdict).toBe('equivalent');
  });

  it('代数恒等：交换序、上标记号（² 须在 NFKC 前映射）', () => {
    expect(verifyAnswerEquivalence('x^2+1', '1+x²').verdict).toBe('equivalent');
  });

  it('根式记号归一：√2 与 sqrt(2) 等价', () => {
    expect(verifyAnswerEquivalence('√2', 'sqrt(2)').verdict).toBe('equivalent');
  });

  it('数值不等', () => {
    const r = verifyAnswerEquivalence('2', '3');
    expect(r.verdict).toBe('not_equivalent');
  });

  it('多值集合：乱序等价', () => {
    expect(verifyAnswerEquivalence('x=3 或 x=-1', 'x=-1, x=3').verdict).toBe('equivalent');
  });

  it('多值集合：漏根判不等（case_miss 线索）', () => {
    const r = verifyAnswerEquivalence('x=3', 'x=3 或 x=-1');
    expect(r.verdict).toBe('not_equivalent');
    expect(r.reason).toContain('漏');
  });

  it('单位差异：数值等价但标 unitMismatch', () => {
    const r = verifyAnswerEquivalence('3米', '3');
    expect(r.verdict).toBe('equivalent');
    expect(r.unitMismatch).toBe(true);
  });

  it('非数学作答安全降级为无法判定，不抛错', () => {
    const r = verifyAnswerEquivalence('不会做', 'x=1');
    expect(r.verdict).toBe('unverifiable');
  });

  it('含未定义符号的表达式不误判', () => {
    // a 与 b 都是自由符号，数值兜底算不出常数 → unverifiable
    expect(verifyAnswerEquivalence('a+b', 'b+a').verdict).toBe('equivalent'); // simplify 恒等通道先命中
    expect(verifyAnswerEquivalence('a+b', 'a-b').verdict).toBe('not_equivalent'); // simplify 差式非零
  });

  it('超长输入拒绝判定', () => {
    const long = '1+'.repeat(500) + '1';
    expect(verifyAnswerEquivalence(long, '2').verdict).toBe('unverifiable');
  });

  it('空输入无法判定', () => {
    expect(verifyAnswerEquivalence('', '3').verdict).toBe('unverifiable');
  });
});
