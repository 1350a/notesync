import { describe, expect, it } from 'vitest';
import { deepseekProvider } from '../../../lib/provider/deepseek.ts';

describe('DeepSeekProvider.modelAcceptsImages（按模型名判定图片能力）', () => {
  it('deepseek-flash：官方 Vision 款，可直传图片', () => {
    expect(deepseekProvider.modelAcceptsImages('deepseek-flash')).toBe(true);
  });

  it('deepseek-v4-pro：纯文本款，直传会被上游 400，判 false', () => {
    expect(deepseekProvider.modelAcceptsImages('deepseek-v4-pro')).toBe(false);
  });

  it('deepseek-v4-flash：含 flash 的过渡别名，仍判可直传', () => {
    expect(deepseekProvider.modelAcceptsImages('deepseek-v4-flash')).toBe(true);
  });

  it('含 vision 的别名：保留兼容，判可直传', () => {
    expect(deepseekProvider.modelAcceptsImages('deepseek-vision-exp')).toBe(true);
  });

  it('大小写与首尾空白不敏感', () => {
    expect(deepseekProvider.modelAcceptsImages('  DeepSeek-Flash ')).toBe(true);
    expect(deepseekProvider.modelAcceptsImages('DEEPSEEK-V4-PRO')).toBe(false);
  });
});
