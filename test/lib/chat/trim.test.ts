import { describe, expect, it } from 'vitest';
import { estimateCost, logCost } from '../../../lib/chat/cost.ts';
import { DEFAULT_TRIM_BUDGET_CHARS, resolveTrimBudget, trimMessages, TRIM_NOTICE } from '../../../lib/chat/trim.ts';

describe('trimMessages（长会话上下文裁剪，总账 §9.1）', () => {
  const msg = (role: 'user' | 'assistant', text: string) => ({ role, content: text });

  it('预算内原样返回，不触发', () => {
    const messages = [msg('user', '短消息')];
    const r = trimMessages(messages, 1000);
    expect(r.trimmed).toBe(false);
    expect(r.messages).toBe(messages);
  });

  it('budget=0 禁用裁剪', () => {
    const messages = [msg('user', 'x'.repeat(500))];
    expect(trimMessages(messages, 0).trimmed).toBe(false);
  });

  it('超预算：从最旧一侧收口，最新用户消息永不裁，留省略提示', () => {
    const messages = [
      msg('user', 'A'.repeat(500)),
      msg('assistant', 'B'.repeat(500)),
      msg('user', 'C'.repeat(500)),
      msg('assistant', 'D'.repeat(100)),
      msg('user', '当前题目输入'),
    ];
    const r = trimMessages(messages, 800);
    expect(r.trimmed).toBe(true);
    expect(r.dropped).toBeGreaterThan(0);
    const first = r.messages[0];
    expect(first.role === 'user' && first.content === TRIM_NOTICE).toBe(true);
    // 最新用户消息必须在
    expect(r.messages.at(-1)).toMatchObject({ role: 'user', content: '当前题目输入' });
    // 总量收进预算
    const total = r.messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
    expect(total).toBeLessThanOrEqual(800 + TRIM_NOTICE.length);
  });

  it('默认预算常量与环境变量解析', () => {
    expect(DEFAULT_TRIM_BUDGET_CHARS).toBeGreaterThan(0);
    expect(resolveTrimBudget()).toBeGreaterThan(0);
  });
});

describe('estimateCost（成本计量，总账 §9.1）', () => {
  it('调用次数精确、token 给区间而非假精确', () => {
    const record = estimateCost({
      route: '/api/chat',
      clientId: 'c1',
      calls: 3,
      messages: [{ content: '一二三四五六七八九十' }, { content: 'abcdefghij' }],
    });
    expect(record.calls).toBe(3);
    expect(record.requestChars).toBe(20);
    expect(record.tokensEstimate[0]).toBeLessThanOrEqual(record.tokensEstimate[1]);
  });

  it('logCost 不抛错（含循环引用防御交给 JSON 异常路径）', () => {
    expect(() => logCost(estimateCost({ route: 'r', clientId: 'c', calls: 1, messages: [] }))).not.toThrow();
  });
});
