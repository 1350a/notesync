/**
 * submit_diagnosis 工具（诊断模式结构化提交）
 *
 * 以工厂而非注册表单例提供：提交存储是逐请求的（store 由 route 创建、finalize 消费），
 * 注册表单例的全局存储在并发请求下会互相覆盖。因此不经 registerBuiltinTools 注册，
 * 由诊断模式的 route 按请求组装（见 app/api/chat/route.ts）。
 * 真正的提交校验在 lib/diagnose/runtime.ts parseSubmission，工具层只收件。
 */
import { RETRY_HINTS } from '../../diagnose/prompts.ts';
import { detectSubmissionLeak } from '../../diagnose/submission-guard.ts';
import type { ToolDefinition } from '../types.ts';

/** 逐请求提交存储：最后一次 submit 生效 */
export interface SubmissionStore {
  args: Record<string, unknown> | null;
}

export function createSubmissionStore(): SubmissionStore {
  return { args: null };
}

export function createSubmitDiagnosisTool(store: SubmissionStore): ToolDefinition {
  return {
    name: 'submit_diagnosis',
    description:
      '提交结构化诊断结果，诊断模式每个阶段结束时必须调用一次。' +
      '参数：isMath（是否数学题，intake 判学科时必填）、level（L1 题目画像 / L2 错因归因）、' +
      'knowledgePoints（1~3 条考点）、errorCause（主错因 {code, confidence}，code 必须取自错因枚举表，L2 必填；L1 无错因时传字面 null）、' +
      'secondaryErrorCause（可选次错因）、hints（提示阶梯 [{level: 1|2|3, content}]，仅 L2 可用；L1 提交一律省略，否则被拒）、' +
      'completeness（材料完整度四布尔，intake 阶段必填、四个键齐全）、notes（如「未提供作答，本次不做错因归因」）。',
    inputSchema: {
      type: 'object',
      properties: {
        isMath: { type: 'boolean', description: '是否数学题；非数学题传 false' },
        level: { type: 'string', enum: ['L1', 'L2'], description: '诊断级别' },
        knowledgePoints: {
          type: 'array',
          items: { type: 'string' },
          maxLength: 3,
          description: '考点清单，1~3 条',
        },
        errorCause: {
          type: ['object', 'null'],
          description:
            '主错因 {code, confidence}；code 取错因枚举表，confidence 为 0~1。' +
            'L1（题目画像，不做错因归因）无错因时必须传字面 null，不得传 {code:null,confidence:null} 这类空对象',
        },
        secondaryErrorCause: {
          type: ['object', 'null'],
          description: '可选次错因 {code, confidence}；没有就省略或传字面 null，不要传空对象',
        },
        completeness: {
          type: 'object',
          description:
            '材料完整度四布尔（intake 阶段必填，其余阶段可选）：hasProblem 有题目 / hasStudentAnswer 有学生作答 / ' +
            'hasCorrectAnswer 有正确答案 / hasAnalysis 有解析。四个键必须齐全且都是布尔，' +
            '不填则服务端回落实测基线（聊天链路会按全 false 处理，判级停在 L1）；这些判定只放在本字段，不要写进 notes。',
          properties: {
            hasProblem: { type: 'boolean', description: '材料里是否有题目' },
            hasStudentAnswer: { type: 'boolean', description: '材料里是否有学生作答' },
            hasCorrectAnswer: { type: 'boolean', description: '材料里是否有正确答案' },
            hasAnalysis: { type: 'boolean', description: '材料里是否有解析' },
          },
          required: ['hasProblem', 'hasStudentAnswer', 'hasCorrectAnswer', 'hasAnalysis'],
        },
        hints: {
          type: 'array',
          items: { type: 'object' },
          description: '提示阶梯 [{level: 1|2|3, content}]；L1 提交一律省略（提示阶梯由讲解阶段逐级给出，L1 带非空 hints 会被拒绝）',
        },
        notes: { type: 'string', description: '声明性备注，如降级原因' },
      },
      required: ['level', 'knowledgePoints'],
    },
    handler: async (args) => {
      // 提交前校验（C1）：学生可见文本里出现英文 code 或内部字段名，就在落地前拦回。
      // 命中即抛错 → invoke 包成 ok=false 回填模型；正文此时还没定稿，模型在同一轮 loop
      // 内改一个点重交即可。store 不写入，保证脏提交不会被 finalize 读到。
      const leak = detectSubmissionLeak(args as Record<string, unknown>);
      if (leak) {
        console.warn(`[diagnose] 提交被拦回：${leak.kind} 命中 ${leak.field}（${leak.sample}）`);
        throw new Error(RETRY_HINTS[leak.kind]);
      }
      // 其余字段的必填/取值校验统一在 parseSubmission，校验失败的纠正提示由 finalize 编排
      store.args = args;
      return { kind: 'result', data: { ok: true }, summary: '已收到结构化诊断提交' };
    },
  };
}
