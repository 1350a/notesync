import { describe, expect, it } from 'vitest';
import {
  checkAnswerQuote,
  normalizeForQuote,
  QUOTE_BIGRAM_THRESHOLD,
  QUOTE_MIN_RUN_CHARS,
} from '../../../lib/diagnose/guard.ts';

describe('normalizeForQuote', () => {
  it('收全角、去空白标点、转小写', () => {
    expect(normalizeForQuote('Ｘ＝２，ｘ＋１')).toBe(normalizeForQuote('x=2,x+1'));
    expect(normalizeForQuote('解： x = 3 。')).toBe('解x=3');
  });

  it('比较符保留：「>0」与「≥0」归一后不同（对错关键不抹平）', () => {
    expect(normalizeForQuote('b²-4ac=9-4k>0')).not.toBe(normalizeForQuote('b²-4ac=9-4k≥0'));
    expect(normalizeForQuote('√２')).toBe('√2');
  });
});

describe('checkAnswerQuote（wip-diagnosis-model.md §7.3）', () => {
  const source = '由判别式 b²-4ac=9-4k>0，解得 k<9/4';

  it('引用作答片段（连续原文窗口）：run 命中', () => {
    const r = checkAnswerQuote({
      output: '你写到 b²-4ac=9-4k>0 就停了，但没讨论另一个根。',
      studentSources: [source],
    });
    expect(r.quoted).toBe(true);
    expect(r.best?.via).toBe('run');
    expect(r.best?.score).toBe(1);
  });

  it('全角/空白差异不挡窗口命中', () => {
    const r = checkAnswerQuote({
      output: '你先写了「解得ｋ＜９／４」，方向反了。',
      studentSources: [source],
    });
    expect(r.quoted).toBe(true);
  });

  it('轻度改写（短来源、无完整窗口）：bigram 兜底命中', () => {
    const r = checkAnswerQuote({
      output: '你写的 k<9/4 这步是对的。',
      studentSources: ['解得k<9/4'],
    });
    expect(r.quoted).toBe(true);
    expect(r.best?.via).toBe('bigram');
    expect(r.best?.score).toBeGreaterThanOrEqual(QUOTE_BIGRAM_THRESHOLD);
  });

  it('完全没引用作答：判不通过', () => {
    const r = checkAnswerQuote({
      output: '这道题考二次方程根的分布，先看判别式，再看开口方向。',
      studentSources: [source],
    });
    expect(r.quoted).toBe(false);
    expect(r.best).toBeNull();
  });

  it('引用含转写差异但保留长片段：算引用（锚定成立，边界差异交提示词层裁量）', () => {
    const r = checkAnswerQuote({
      output: '你写到 b²-4ac=9-4k≥0，边界取等错了。',
      studentSources: [source],
    });
    // b^2-4ac=9-4k 连续 12 字仍在——模型确实锚定了作答表达式
    expect(r.quoted).toBe(true);
    expect(QUOTE_MIN_RUN_CHARS).toBeLessThanOrEqual('b^2-4ac=9-4k'.length);
  });

  it('多来源时任一命中即可，报告来源下标', () => {
    const r = checkAnswerQuote({
      output: '你写到「x=2另一个根没写」，对吗？',
      studentSources: ['第一行字迹模糊看不清', 'x=2，另一个根没写'],
    });
    expect(r.quoted).toBe(true);
    expect(r.best?.sourceIndex).toBe(1);
  });

  it('短来源（数值答案）整段出现即命中，未出现不命中', () => {
    expect(checkAnswerQuote({ output: '你写到 x=2 就停了，另一个根呢？', studentSources: ['x=2'] }).quoted).toBe(true);
    expect(checkAnswerQuote({ output: '这道题考一元二次方程的解法。', studentSources: ['x=2'] }).quoted).toBe(false);
  });

  it('空白来源忽略', () => {
    const r = checkAnswerQuote({ output: '任意输出', studentSources: ['', '   '] });
    expect(r.quoted).toBe(false);
  });
});
