import { describe, expect, it } from 'vitest';
import { mapMaxTokens } from '../../../lib/provider/openaiCompat.ts';
import {
  MAX_TOKENS_MAX,
  MAX_TOKENS_MIN,
  MAX_TOKENS_PRESETS,
  normalizeMaxTokens,
} from '../../../lib/settings/types.ts';

describe('mapMaxTokens（思考预算 → Provider 请求体 max_tokens，doc/user-settings.md §2.1）', () => {
  it('deepseek：按值下发 max_tokens，三档预设原样透传', () => {
    expect(mapMaxTokens('deepseek', MAX_TOKENS_PRESETS.low)).toBe(1024);
    expect(mapMaxTokens('deepseek', MAX_TOKENS_PRESETS.medium)).toBe(4096);
    expect(mapMaxTokens('deepseek', MAX_TOKENS_PRESETS.high)).toBe(8192);
  });

  it('zhipu：同样支持 max_tokens，按值下发', () => {
    expect(mapMaxTokens('zhipu', 2048)).toBe(2048);
  });

  it('custom：恒不下发（未知字段严格校验风险，与 thinking / user 字段同口径）', () => {
    expect(mapMaxTokens('custom', 8192)).toBeUndefined();
    expect(mapMaxTokens('custom', 1024)).toBeUndefined();
  });

  it('未设置（undefined）：不发送，跟随 provider 默认', () => {
    expect(mapMaxTokens('deepseek', undefined)).toBeUndefined();
    expect(mapMaxTokens('zhipu', undefined)).toBeUndefined();
  });

  it('防呆：非有限数与非法小值一律不下发，小数向下取整', () => {
    expect(mapMaxTokens('deepseek', Number.NaN)).toBeUndefined();
    expect(mapMaxTokens('deepseek', Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(mapMaxTokens('deepseek', 0)).toBeUndefined();
    expect(mapMaxTokens('deepseek', -1)).toBeUndefined();
    expect(mapMaxTokens('deepseek', 4096.9)).toBe(4096);
  });
});

describe('normalizeMaxTokens（设置项与服务端请求体同一口径）', () => {
  it('合法的三档预设原样保留', () => {
    expect(normalizeMaxTokens(MAX_TOKENS_PRESETS.low)).toBe(1024);
    expect(normalizeMaxTokens(MAX_TOKENS_PRESETS.medium)).toBe(4096);
    expect(normalizeMaxTokens(MAX_TOKENS_PRESETS.high)).toBe(8192);
  });

  it('超上限钳制到 MAX_TOKENS_MAX，小数向下取整', () => {
    expect(normalizeMaxTokens(999_999_999)).toBe(MAX_TOKENS_MAX);
    expect(normalizeMaxTokens(10.9)).toBe(10);
  });

  it('非数值 / 非有限数 / 小于下限一律视为未设置', () => {
    expect(normalizeMaxTokens(0)).toBeUndefined();
    expect(normalizeMaxTokens(-5)).toBeUndefined();
    expect(normalizeMaxTokens(Number.NaN)).toBeUndefined();
    expect(normalizeMaxTokens(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizeMaxTokens('4096')).toBeUndefined();
    expect(normalizeMaxTokens(null)).toBeUndefined();
    expect(normalizeMaxTokens(undefined)).toBeUndefined();
  });

  it('下限边界：MAX_TOKENS_MIN 本身保留', () => {
    expect(normalizeMaxTokens(MAX_TOKENS_MIN)).toBe(MAX_TOKENS_MIN);
    expect(normalizeMaxTokens(MAX_TOKENS_MIN - 1)).toBeUndefined();
  });
});
