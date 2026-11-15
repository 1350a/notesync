import { describe, expect, it } from 'vitest';
import { THINKING_EFFORTS, thinkingOffMeansDisabled } from '../../../lib/settings/types.ts';

describe('thinkingOffMeansDisabled（off 档文案口径，doc/user-settings.md §2.1）', () => {
  it('deepseek：off 是真关闭，文案保留「关闭」', () => {
    expect(thinkingOffMeansDisabled('deepseek')).toBe(true);
  });

  it('zhipu / custom / ollama：关不掉思考，文案改为「默认」', () => {
    expect(thinkingOffMeansDisabled('zhipu')).toBe(false);
    expect(thinkingOffMeansDisabled('custom')).toBe(false);
    expect(thinkingOffMeansDisabled('ollama')).toBe(false);
  });

  it('provider 未知（未选模型）：按「默认」处理，不虚标关闭', () => {
    expect(thinkingOffMeansDisabled(undefined)).toBe(false);
    expect(thinkingOffMeansDisabled(null)).toBe(false);
    expect(thinkingOffMeansDisabled('')).toBe(false);
  });

  it('四档在任何 provider 下都完整存在（文案差异不锁档）', () => {
    expect(THINKING_EFFORTS).toEqual(['off', 'low', 'medium', 'high']);
  });
});
