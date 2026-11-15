/*
 * normalizeMessagesForRequestBody（思考回传的 Provider 分流）用例
 *
 * 协议口径 doc/tool-protocol.md §4.3：reasoning_content 仅 deepseek 且该请求
 * 处于思考模式时下发；zhipu / custom 恒剥离（未知字段严格校验风险），
 * 思考关闭的请求没有回传语义、同样剥离。
 */
import { describe, expect, it } from 'vitest';
import { normalizeMessagesForRequestBody } from '../../../lib/provider/openaiCompat.ts';
import type { ProviderMessage } from '../../../lib/provider/types.ts';

/** 带 reasoning_content 的典型历史（含 tool_calls 形态的 assistant 消息） */
const withReasoning = (): ProviderMessage[] => [
  { role: 'system', content: '诊断提示词' },
  { role: 'user', content: '题面' },
  { role: 'assistant', content: '上一轮回答', reasoning_content: '思考全文' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'submit_diagnosis', arguments: '{}' } },
    ],
    reasoning_content: '工具轮思考',
  },
];

describe('normalizeMessagesForRequestBody（reasoning_content 下发分流）', () => {
  it('deepseek + 思考开启：reasoning_content 原样保留', () => {
    for (const effort of ['low', 'medium', 'high'] as const) {
      const out = normalizeMessagesForRequestBody('deepseek', withReasoning(), effort);
      const assistants = out.filter((m) => m.role === 'assistant');
      expect(assistants.map((m) => m.reasoning_content)).toEqual(['思考全文', '工具轮思考']);
    }
  });

  it('deepseek + 思考关闭/未指定：剥离（非思考请求没有回传语义）', () => {
    for (const effort of [undefined, 'off'] as const) {
      const out = normalizeMessagesForRequestBody('deepseek', withReasoning(), effort);
      expect(out.some((m) => 'reasoning_content' in m)).toBe(false);
    }
  });

  it('zhipu / custom：即使思考开启也剥离（未知字段严格校验风险）', () => {
    for (const name of ['zhipu', 'custom'] as const) {
      const out = normalizeMessagesForRequestBody(name, withReasoning(), 'high');
      expect(out.some((m) => 'reasoning_content' in m)).toBe(false);
    }
  });

  it('剥离只动 reasoning_content，其余协议字段不受影响', () => {
    const out = normalizeMessagesForRequestBody('zhipu', withReasoning(), 'high');
    const toolMsg = out.find((m) => m.tool_calls);
    expect(toolMsg?.tool_calls?.[0]?.function.name).toBe('submit_diagnosis');
    expect(toolMsg?.content).toBe('');
    // 消息条数与角色序列不变
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'assistant']);
  });
});
