/**
 * 内置工具：ask_user
 *
 * 语义：不产生工具结果，而是中断本轮，等待用户回答（见 doc §6）。
 * 这是工具层"中断/恢复"路径的验证工具，也是 P2 的 smoke 目标。
 *
 * 参数校验由 invoke 统一完成（minLength/maxLength/required）；
 * handler 内再 trim 一次，防止纯空格通过 minLength 检查。
 */
import type { ToolDefinition } from '../types.ts';

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description:
    '当需要向用户确认信息、追问关键细节时使用。调用后本轮对话会暂停，等待用户回答后再继续。一次只提一个最关键的、具体可回答的问题。',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '要向用户提出的问题，应具体、明确，不要含糊其辞',
        minLength: 1,
        maxLength: 500,
      },
    },
    required: ['question'],
  },
  handler: async (args) => {
    const raw = args.question;
    const question = typeof raw === 'string' ? raw.trim() : '';
    // 兜底：validateArguments 已校验 minLength，但纯空格能绕过长度检查
    if (!question) {
      throw new Error('question 不能为空');
    }
    return { kind: 'awaiting_user', question };
  },
};
