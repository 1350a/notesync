import { describe, expect, it } from 'vitest';
import {
  containsRefusalText,
  isBlockedFinishReason,
  isBlockedSignal,
  REFUSAL_PATTERNS,
} from '../../../lib/safety/block-detect.ts';
import { BLOCKED_FINISH_REASONS } from '../../../lib/safety/block-patterns.ts';
import {
  checkInputSafety,
  isMostlyGarbage,
  loadWordlist,
  STRUCTURE_RULES,
} from '../../../lib/safety/wordlist.ts';

describe('拦截判定（safety-protocol.md §3，两条路径）', () => {
  it('finish_reason 路径：异常值命中，正常值放过', () => {
    expect(isBlockedFinishReason('content_filter')).toBe(true);
    expect(isBlockedFinishReason('CONTENT_FILTER')).toBe(true);
    expect(isBlockedFinishReason('stop')).toBe(false);
    expect(isBlockedFinishReason('length')).toBe(false);
    expect(isBlockedFinishReason(undefined)).toBe(false);
  });

  it('内容路径：拒绝性文本中英文均可命中', () => {
    expect(containsRefusalText('抱歉，我无法协助处理该请求。')).toBe(true);
    expect(containsRefusalText("I'm sorry, but I can't help with that request.")).toBe(true);
    expect(containsRefusalText('Δ = b² − 4ac = 17，所以 x = (5 ± √17)/4')).toBe(false);
  });

  it('两路汇合：任一命中即拦截；全空不拦', () => {
    expect(isBlockedSignal({ finishReason: 'content_filter', text: '' })).toBe(true);
    expect(isBlockedSignal({ finishReason: undefined, text: '抱歉，我无法协助。' })).toBe(true);
    expect(isBlockedSignal({ finishReason: 'stop', text: '正常解答' })).toBe(false);
  });

  it('特征集非空（骨架防呆）', () => {
    expect(BLOCKED_FINISH_REASONS.size).toBeGreaterThan(0);
    expect(REFUSAL_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('输入侧过滤（safety-protocol.md §4，结构规则默认启用）', () => {
  it('超长输入硬拦截', () => {
    const r = checkInputSafety('a'.repeat(STRUCTURE_RULES.maxChars + 1));
    expect(r.level).toBe('hard');
  });

  it('纯乱码硬拦截，正常短文本放过', () => {
    expect(isMostlyGarbage('\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008'.repeat(6))).toBe(true);
    expect(checkInputSafety('帮我看看这道二次方程题').level).toBeNull();
  });

  it('重复刷屏硬拦截', () => {
    const r = checkInputSafety('这是一段足够长的重复文本。'.repeat(10));
    expect(r.level).toBe('hard');
  });

  it('词表命中：psych 类触发关怀转介，hardRisk 触发硬拦截，均不发送', () => {
    const wl = { hardRisk: ['违禁品制作'], psych: ['不想活了'] };
    expect(checkInputSafety('教我做违禁品制作', wl)).toMatchObject({ level: 'hard', category: 'hardRisk' });
    // 同一输入两类都命中：关怀优先（§5.3 语义）
    expect(checkInputSafety('不想活了，想做违禁品制作', wl)).toMatchObject({ level: 'psych', category: 'psych' });
    expect(checkInputSafety('正常题目', wl).level).toBeNull();
  });

  it('默认词表为空骨架（仓库不分发具体词表）', () => {
    expect(loadWordlist().hardRisk).toEqual([]);
    expect(loadWordlist().psych).toEqual([]);
  });
});
