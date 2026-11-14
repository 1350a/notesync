import { describe, expect, it } from 'vitest';
import { parseUsage } from '../../../lib/provider/openaiCompat.ts';

/**
 * usage 解析（trace 观测面补齐项）：上游三种形态都要能吃，
 * 全都吃不到时必须返回 undefined——用量缺口要能被标记成「上游未提供」，
 * 不能被静默记成 0（否则成本台账会长期偏低且无人发现）。
 */
describe('parseUsage（上游 usage → TokenUsage）', () => {
  it('非流式顶层 usage：三个字段全取', () => {
    expect(parseUsage({ prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 })).toEqual({
      promptTokens: 120,
      completionTokens: 340,
      totalTokens: 460,
    });
  });

  it('流式末尾 usage chunk：同样字段名，照样归一', () => {
    expect(parseUsage({ completion_tokens: 88, total_tokens: 108 })).toEqual({
      promptTokens: undefined,
      completionTokens: 88,
      totalTokens: 108,
    });
  });

  it('部分字段非数字：只取数字字段，不猜也不补 0', () => {
    expect(parseUsage({ prompt_tokens: 10, completion_tokens: '340' })).toEqual({
      promptTokens: 10,
      completionTokens: undefined,
      totalTokens: undefined,
    });
  });

  it('缺失 / 空值 / 非对象：一律 undefined（上游未提供）', () => {
    expect(parseUsage(undefined)).toBeUndefined();
    expect(parseUsage(null)).toBeUndefined();
    expect(parseUsage({})).toBeUndefined();
    expect(parseUsage('120')).toBeUndefined();
    expect(parseUsage({ prompt_tokens: null, total_tokens: null })).toBeUndefined();
  });
});
