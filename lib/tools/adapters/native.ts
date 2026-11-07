/**
 * Native 模式适配器
 *
 * 依赖模型原生支持 OpenAI tools 协议。
 * 特征：请求带 tools 数组，模型返回 finish_reason="tool_calls" 及结构化 tool_calls。
 */
import type {
  CompleteOptions,
  ProviderMessage,
  ProviderToolCall,
  StreamDelta,
} from '@/lib/provider/types.ts';
import { renderForNative } from '../render.ts';
import type {
  ExtractedToolCall,
  ExtractedToolCalls,
  ToolDefinition,
  ToolInvocation,
} from '../types.ts';
import type { ToolAdapter } from './types.ts';

export class NativeAdapter implements ToolAdapter {
  buildRequest(
    model: string,
    messages: ProviderMessage[],
    tools: ToolDefinition[]
  ): CompleteOptions {
    return {
      model,
      messages,
      tools: tools.length > 0 ? renderForNative(tools) : undefined,
      toolChoice: tools.length > 0 ? 'auto' : undefined,
    };
  }

  async processStream(
    stream: AsyncGenerator<StreamDelta>,
    onContent: (delta: string) => void,
    onReasoning: (delta: string) => void
  ): Promise<ExtractedToolCalls> {
    let rawContent = '';
    // 按 index 累积 tool_calls 增量
    const toolCallsMap = new Map<number, { id: string; name: string; argsBuf: string }>();

    for await (const delta of stream) {
      if (delta.content) {
        rawContent += delta.content;
        onContent(delta.content);
      }
      if (delta.reasoning) {
        onReasoning(delta.reasoning);
      }
      if (delta.toolCall) {
        const tc = delta.toolCall;
        const idx = tc.index;
        if (!toolCallsMap.has(idx)) {
          toolCallsMap.set(idx, { id: tc.id || '', name: tc.name || '', argsBuf: '' });
        }
        const item = toolCallsMap.get(idx)!;
        if (tc.id && !item.id) item.id = tc.id;
        if (tc.name && !item.name) item.name = tc.name;
        if (tc.argumentsDelta) item.argsBuf += tc.argumentsDelta;
      }
    }

    const calls: ExtractedToolCall[] = [];
    let parseError: string | undefined;

    for (const [index, item] of Array.from(toolCallsMap.entries()).sort((a, b) => a[0] - b[0])) {
      try {
        const args = JSON.parse(item.argsBuf || '{}') as Record<string, unknown>;
        calls.push({ id: item.id, name: item.name, arguments: args });
      } catch (err) {
        parseError = `工具调用 ${item.name} (index ${index}) 的参数 JSON 解析失败: ${err instanceof Error ? err.message : '未知错误'}`;
      }
    }

    return { calls, raw: rawContent, parseError };
  }

  appendResults(
    messages: ProviderMessage[],
    calls: ExtractedToolCall[],
    results: ToolInvocation[]
  ): void {
    if (calls.length === 0) return;

    // 1. 拼入 assistant 的 tool_calls
    const providerCalls: ProviderToolCall[] = calls.map((c) => ({
      id: c.id,
      type: 'function',
      function: {
        name: c.name,
        arguments: JSON.stringify(c.arguments),
      },
    }));

    messages.push({
      role: 'assistant',
      content: '', // 工具调用轮通常无正文
      tool_calls: providerCalls,
    });

    // 2. 拼入 tool 结果
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const res = results[i];
      let contentStr = '';

      if (res.kind === 'awaiting_user') {
        // 在 native 协议中，有 tool_calls 就必须有 tool 消息回填。
        // 但 ask_user 语义上是中断，这里给一个占位结果以便通过协议校验，
        // 实际 ask_user 场景下 loop 会直接退出。
        contentStr = JSON.stringify({ awaiting_user: res.question });
      } else if (res.ok) {
        contentStr = JSON.stringify({ ok: true, data: res.data });
      } else {
        contentStr = JSON.stringify({ ok: false, error: res.error });
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: contentStr,
      });
    }
  }

  preprocessMessages(messages: ProviderMessage[]): ProviderMessage[] {
    // 收集所有 ask_user 调用的 ID，用于后续将不合规的 tool 消息剔除
    const askUserCallIds = new Set<string>();
    for (const m of messages) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (tc.function.name === 'ask_user') {
            askUserCallIds.add(tc.id);
          }
        }
      }
    }

    return messages.flatMap((m) => {
      // 防御性清洗：如果历史里残留了 ask_user 对应的 tool 消息，直接丢弃。
      // 避免引发 "tool message without preceding tool_calls" 的协议报错。
      if (m.role === 'tool' && m.tool_call_id && askUserCallIds.has(m.tool_call_id)) {
        return [];
      }

      // 将包含 ask_user 的 assistant 消息转为普通自然语言文本
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const askCall = m.tool_calls.find((tc) => tc.function.name === 'ask_user');
        if (askCall) {
          try {
            const args = JSON.parse(askCall.function.arguments) as { question?: string };
            const q = typeof args.question === 'string' ? args.question : '请补充信息';
            return [{ role: 'assistant', content: `（询问用户）${q}` }];
          } catch {
            return [{ role: 'assistant', content: '（向用户提问了问题）' }];
          }
        }
      }

      return [m];
    });
  }
}
