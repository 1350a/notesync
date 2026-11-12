import { describe, expect, it } from 'vitest';
import { mapThinkingParam } from '../../../lib/provider/openaiCompat.ts';

describe('mapThinkingParam（思考强度 → Provider 请求参数，doc/user-settings.md §2.1）', () => {
  it('zhipu：只有开/关粒度，off 发 disabled，其余统一 enabled', () => {
    expect(mapThinkingParam('zhipu', 'off')).toEqual({ thinking: { type: 'disabled' } });
    expect(mapThinkingParam('zhipu', 'low')).toEqual({ thinking: { type: 'enabled' } });
    expect(mapThinkingParam('zhipu', 'medium')).toEqual({ thinking: { type: 'enabled' } });
    expect(mapThinkingParam('zhipu', 'high')).toEqual({ thinking: { type: 'enabled' } });
  });

  it('deepseek：reasoning_effort 档位；off 不发送（关闭语义由模型选择承担）', () => {
    expect(mapThinkingParam('deepseek', 'low')).toEqual({ reasoning_effort: 'low' });
    expect(mapThinkingParam('deepseek', 'high')).toEqual({ reasoning_effort: 'high' });
    expect(mapThinkingParam('deepseek', 'off')).toBeNull();
  });

  it('custom：恒不发送（未知字段严格校验风险，与 user 字段开关同口径）', () => {
    expect(mapThinkingParam('custom', 'high')).toBeNull();
    expect(mapThinkingParam('custom', 'off')).toBeNull();
  });

  it('未设置（undefined）：不发送，跟随 provider 默认', () => {
    expect(mapThinkingParam('zhipu', undefined)).toBeNull();
    expect(mapThinkingParam('deepseek', undefined)).toBeNull();
  });
});
