/*
 * Native 适配器思考回传用例（doc/tool-protocol.md §4.3）
 *
 * processStream 在转发增量的同时累积 reasoning 全文随结果带出；
 * appendResults 把思考挂到 assistant 历史消息的 reasoning_content——
 * DeepSeek 思考模式 + tools 的硬校验缺失该字段即 HTTP 400。
 */
import { describe, expect, it } from 'vitest';
import { NativeAdapter } from '../../../lib/tools/adapters/native.ts';
import type { StreamDelta } from '../../../lib/provider/types.ts';
import type { ProviderMessage } from '../../../lib/provider/types.ts';
import type { ToolInvocation } from '../../../lib/tools/types.ts';

async function* streamOf(deltas: StreamDelta[]): AsyncGenerator<StreamDelta> {
  for (const delta of deltas) yield delta;
}

const toolCallDeltas: StreamDelta[] = [
  { reasoning: '先想' },
  { content: '答案正文' },
  { reasoning: '再想' },
  {
    toolCall: {
      index: 0,
      id: 'c1',
      name: 'submit_diagnosis',
      argumentsDelta: '{"level":"L1"}',
    },
  },
  { finishReason: 'tool_calls' },
];

describe('NativeAdapter 思考回传', () => {
  it('processStream 累积 reasoning 增量并随结果带出（转发不受影响）', async () => {
    const adapter = new NativeAdapter();
    const reasons: string[] = [];
    const contents: string[] = [];
    const result = await adapter.processStream(streamOf(toolCallDeltas), (c) => contents.push(c), (r) =>
      reasons.push(r)
    );
    expect(contents).toEqual(['答案正文']);
    expect(reasons).toEqual(['先想', '再想']);
    expect(result.reasoning).toBe('先想再想');
    expect(result.raw).toBe('答案正文');
    expect(result.calls[0]?.name).toBe('submit_diagnosis');
    expect(result.finishReason).toBe('tool_calls');
  });

  it('appendResults 把 assistantReasoning 挂到 reasoning_content', () => {
    const adapter = new NativeAdapter();
    const messages: ProviderMessage[] = [];
    const results: ToolInvocation[] = [{ kind: 'result', ok: true, data: {}, summary: '已提交' }];
    adapter.appendResults(
      messages,
      [{ id: 'c1', name: 'submit_diagnosis', arguments: { level: 'L1' } }],
      results,
      '正文',
      '思考全文'
    );
    // appendResults 回填两条：assistant（正文 + tool_calls + 思考）与 tool 结果
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('正文');
    expect(messages[0].reasoning_content).toBe('思考全文');
    expect(messages[0].tool_calls?.[0]?.id).toBe('c1');
    expect(messages[1].role).toBe('tool');
  });

  it('未传或空串 reasoning 时不挂该字段（思考关闭的轮次保持无字段）', () => {
    const adapter = new NativeAdapter();
    const results: ToolInvocation[] = [{ kind: 'result', ok: true, data: {}, summary: '已提交' }];
    const calls = [{ id: 'c1', name: 'ask_user', arguments: {} }];

    const withoutArg: ProviderMessage[] = [];
    adapter.appendResults(withoutArg, calls, results, '正文');
    expect('reasoning_content' in withoutArg[0]).toBe(false);

    const withBlank: ProviderMessage[] = [];
    adapter.appendResults(withBlank, calls, results, '正文', '   ');
    expect('reasoning_content' in withBlank[0]).toBe(false);
  });
});
