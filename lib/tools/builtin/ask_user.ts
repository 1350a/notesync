/**
 * 内置工具：ask_user
 *
 * 语义：不产生工具结果，而是中断本轮，等待用户回答（见 doc §6）。
 * 一次调用可提出 1~5 个问题，每个问题可附至多 4 个预设选项（建议 2~3 个，
 * 也可以不给）；前端在输入区以问题面板呈现（components/chat/AskUserPanel.tsx），
 * 用户回答后以一条纯文本 user 消息回到下一轮。
 *
 * 参数校验由 invoke 统一完成（类型/长度/required）；
 * 数组条数（minItems/maxItems）校验器暂不校验，由 handler 兜底截断；
 * handler 内再 trim 一次，防止纯空格通过长度检查。
 */
import type { AskUserQuestion, ToolDefinition } from '../types.ts';

/** 单次调用最多提问数：过多会拉长用户等待，也稀释每个问题的回答质量 */
export const MAX_ASK_QUESTIONS = 5;
/** 单个问题的预设选项上限：选项过多时自由输入反而更快 */
export const MAX_ASK_OPTIONS = 4;

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description:
    '当需要向用户确认信息、追问关键细节时使用。一次可提出 1~5 个问题，每个问题可附 2~3 个预设选项（也可以不给，让用户自由回答）。调用后本轮对话会暂停，等用户全部回答后再继续。问题应具体、明确，不要含糊其辞。',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '要向用户提出的问题列表，1~5 个',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          description: '单个问题',
          properties: {
            label: {
              type: 'string',
              description: '可选的问题分类短标题（如"身份确认"、"位置"），不超过 20 字',
              maxLength: 20,
            },
            question: {
              type: 'string',
              description: '问题文本，应具体、明确，不要含糊其辞',
              minLength: 1,
              maxLength: 500,
            },
            options: {
              type: 'array',
              description: '可选的预设选项，2~3 个为宜，至多 4 个；提供后用户仍可自由输入',
              maxItems: 4,
              items: { type: 'string', minLength: 1, maxLength: 200 },
            },
          },
          required: ['question'],
        },
      },
    },
    required: ['questions'],
  },
  handler: async (args) => {
    const raw = args.questions;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('questions 不能为空');
    }
    const questions: AskUserQuestion[] = [];
    for (const item of raw.slice(0, MAX_ASK_QUESTIONS)) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error('questions 的每项必须是对象');
      }
      const q = item as Record<string, unknown>;
      const question = typeof q.question === 'string' ? q.question.trim() : '';
      // 兜底：validateArguments 已校验 minLength，但纯空格能绕过长度检查
      if (!question) {
        throw new Error('question 不能为空');
      }
      const entry: AskUserQuestion = { question };
      if (typeof q.label === 'string' && q.label.trim()) {
        entry.label = q.label.trim().slice(0, 20);
      }
      if (Array.isArray(q.options)) {
        const options = q.options
          .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
          .map((o) => o.trim().slice(0, 200))
          .slice(0, MAX_ASK_OPTIONS);
        if (options.length > 0) {
          entry.options = options;
        }
      }
      questions.push(entry);
    }
    return { kind: 'awaiting_user', questions };
  },
};

/**
 * 把 ask_user 的 arguments（新 questions 数组或旧单 question 字符串）合并为
 * 一行自然语言文本，供两个适配器的 preprocessMessages 做历史清洗（doc §6.3）。
 * 格式：【label】question，问题间用"；"连接，前缀"（询问用户）"。
 */
export function formatAskUserArgs(args: Record<string, unknown>): string {
  const raw = args.questions;
  if (Array.isArray(raw)) {
    const parts = raw
      .map((item) =>
        typeof item === 'object' && item !== null && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null
      )
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => {
        const question =
          typeof item.question === 'string' && item.question.trim() ? item.question.trim() : '请补充信息';
        const label = typeof item.label === 'string' && item.label.trim() ? `【${item.label.trim()}】` : '';
        return `${label}${question}`;
      });
    if (parts.length > 0) {
      return `（询问用户）${parts.join('；')}`;
    }
  }
  // 兼容旧单问题形状（升级前的历史）
  if (typeof args.question === 'string' && args.question.trim()) {
    return `（询问用户）${args.question.trim()}`;
  }
  return '（向用户提问了问题）';
}
