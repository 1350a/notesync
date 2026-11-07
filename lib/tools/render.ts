/**
 * 工具渲染：把 ToolDefinition 转为两种模式所需的形态
 *
 * - renderForNative：转为 OpenAI tools 数组（native 模式请求体用）
 * - renderForText：生成注入 system prompt 的说明文本（text 模式用）
 *
 * 为什么 parameters 用 Record<string, unknown> 而不是 JSONSchemaObject：
 * provider 层不应依赖 tools 层的 JSON Schema 类型，保持解耦；
 * JSONSchemaObject 有索引签名，可直接赋给 Record<string, unknown>。
 */
import type { NativeToolDef } from '@/lib/provider/types.ts';
import type { ToolDefinition } from './types.ts';

/** text 模式围栏标识（与解析器约定，勿随意改） */
export const TEXT_TOOL_FENCE_OPEN = '```tool';
export const TEXT_TOOL_FENCE_CLOSE = '```';

/** native 模式：转为 OpenAI tools 数组 */
export function renderForNative(tools: ToolDefinition[]): NativeToolDef[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/**
 * text 模式：生成注入 system prompt 的说明文本。
 * 由调用方拼接到 system prompt 末尾（P1 不负责拼接）。
 */
export function renderForText(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '';

  const list = tools
    .map((t, i) => {
      return [
        `${i + 1}. ${t.name}`,
        `   描述：${t.description}`,
        `   参数（JSON Schema）：${JSON.stringify(t.inputSchema)}`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    '【可用工具】',
    '你可以在需要时调用以下工具。调用工具时，只输出下面这一种格式，',
    '不要任何额外文字（包括解释、前言、代码块外的标点）：',
    '',
    TEXT_TOOL_FENCE_OPEN,
    '{"tool": "工具名", "arguments": {"参数名": "参数值"}}',
    TEXT_TOOL_FENCE_CLOSE,
    '',
    '【工具清单】',
    list,
    '',
    '【调用规则】',
    '- 一次只能调用一个工具。',
    '- 不需要调用工具时，用自然语言直接回答，不要强行调用。',
    '- 工具执行完毕后，你会收到一条 user 消息，格式为：',
    '  [工具结果] {"ok": true, "data": ...}',
    '  或 [工具结果] {"ok": false, "error": "..."}',
    '- 请基于工具结果继续作答。',
  ].join('\n');
}
