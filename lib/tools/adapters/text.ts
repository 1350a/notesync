/**
 * Text 模式适配器
 *
 * 适用于纯文本或 tool calling 支持不佳的模型。
 * 依赖系统提示词注入格式要求，模型以固定的 ```tool 围栏返回 JSON。
 */
import type { CompleteOptions, ProviderMessage, StreamDelta } from '@/lib/provider/types.ts';
import { renderForText } from '../render.ts';
import type {
  ExtractedToolCall,
  ExtractedToolCalls,
  ToolDefinition,
  ToolInvocation,
} from '../types.ts';
import type { ToolAdapter } from './types.ts';

export class TextAdapter implements ToolAdapter {
  buildRequest(
    model: string,
    messages: ProviderMessage[],
    tools: ToolDefinition[]
  ): CompleteOptions {
    if (tools.length === 0) {
      return { model, messages };
    }

    // 注入工具说明到 system prompt 末尾。
    // 如果已有 system prompt，则追加；如果没有，则在开头插入。
    const toolPrompt = renderForText(tools);
    const nextMessages = [...messages];
    const firstSys = nextMessages.findIndex((m) => m.role === 'system');

    if (firstSys >= 0) {
      // 可能是多模态，这里仅处理纯文本拼接
      const sysMsg = nextMessages[firstSys];
      const contentStr = typeof sysMsg.content === 'string' ? sysMsg.content : '';
      nextMessages[firstSys] = {
        ...sysMsg,
        content: `${contentStr}\n\n${toolPrompt}`,
      };
    } else {
      nextMessages.unshift({
        role: 'system',
        content: toolPrompt,
      });
    }

    return { model, messages: nextMessages };
  }

  async processStream(
    stream: AsyncGenerator<StreamDelta>,
    onContent: (delta: string) => void,
    onReasoning: (delta: string) => void
  ): Promise<ExtractedToolCalls> {
    let rawContent = '';
    let buffer = '';
    let isBuffering = false;
    let decided = false; // 是否已经决定了是走 buffer 还是直接透传

    for await (const delta of stream) {
      if (delta.reasoning) {
        onReasoning(delta.reasoning);
      }
      if (!delta.content) continue;

      const text = delta.content;
      rawContent += text;

      if (!decided) {
        buffer += text;
        // 探测是否以围栏或大括号开头
        const trimmed = buffer.trimStart();
        if (trimmed.length === 0) continue;

        if (trimmed.startsWith('```') || trimmed.startsWith('{')) {
          isBuffering = true;
          decided = true;
        } else {
          // 正常文本，将之前的 buffer 吐出
          isBuffering = false;
          decided = true;
          onContent(buffer);
          buffer = '';
        }
      } else {
        if (isBuffering) {
          buffer += text;
        } else {
          onContent(text);
        }
      }
    }

    // 流结束，处理 buffer
    let parseError: string | undefined;
    const calls: ExtractedToolCall[] = [];

    if (isBuffering && buffer.trim()) {
      const parseResult = parseTextToolCall(buffer);
      if (parseResult.success) {
        calls.push(parseResult.call);
        // 若解析成功，buffer 内的内容不作为正文输出
      } else {
        parseError = parseResult.error;
        // 兜底：如果判定为 Buffer 但解析失败，说明误判了，将内容全部吐给用户
        onContent(buffer);
      }
    } else if (!decided && buffer.trim()) {
      // 流太短，没来得及判定就结束了，直接透传
      onContent(buffer);
    }

    return { calls, raw: rawContent, parseError };
  }

  appendResults(
    messages: ProviderMessage[],
    calls: ExtractedToolCall[],
    results: ToolInvocation[]
  ): void {
    if (calls.length === 0) return;

    // text 模式下，历史中模型的 tool call 就是它的 content。
    // 这里直接把原样发回去，然后模拟 user 发送工具结果。
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const res = results[i];
      let contentStr = '';

      if (res.kind === 'awaiting_user') {
        contentStr = JSON.stringify({ awaiting_user: res.question });
      } else if (res.ok) {
        contentStr = JSON.stringify({ ok: true, data: res.data });
      } else {
        contentStr = JSON.stringify({ ok: false, error: res.error });
      }

      messages.push({
        role: 'user',
        content: `[工具结果] ${contentStr}`,
      });
    }
  }

  preprocessMessages(messages: ProviderMessage[]): ProviderMessage[] {
    return messages.map((m) => {
      if (m.role !== 'assistant' || typeof m.content !== 'string') {
        return m;
      }

      // 检测是否有 ask_user
      const parseResult = parseTextToolCall(m.content);
      if (parseResult.success && parseResult.call.name === 'ask_user') {
        const q = parseResult.call.arguments.question;
        const questionText = typeof q === 'string' ? q : '请补充信息';
        return {
          role: 'assistant',
          content: `（询问用户）${questionText}`,
        };
      }

      return m;
    });
  }
}

/**
 * 尝试从文本中解析工具调用。
 * 容忍：标准围栏、json 围栏、裸 JSON、前后带解释文字。
 */
function parseTextToolCall(
  text: string
): { success: true; call: ExtractedToolCall } | { success: false; error: string } {
  // 1. 提取平衡的 JSON 对象
  const start = text.indexOf('{');
  if (start < 0) return { success: false, error: '未找到 JSON 起始符 {' };

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end < 0) return { success: false, error: 'JSON 大括号不匹配' };

  const jsonStr = text.slice(start, end + 1);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return { success: false, error: 'JSON 解析失败' };
  }

  const name = obj.tool;
  const args = obj.arguments;

  if (typeof name !== 'string' || !name) {
    return { success: false, error: 'JSON 中缺少合法的 tool 字段' };
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return { success: false, error: 'JSON 中缺少合法的 arguments 字段' };
  }

  return {
    success: true,
    call: {
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      arguments: args as Record<string, unknown>,
    },
  };
}
