/**
 * /api/diagnose-paper 的 MOCK 仿真剧本（从路由抽出，只搬不改）。
 *
 * MOCK_MODEL=1 时用一份固定剧本零 token 走完「切题 → 分类 → 分组诊断 → 汇总」四步，
 * 让整卷诊断的步骤条、分组卡片与 done.stats 可在不消耗任何 token、不依赖任何 API key
 * 的前提下被验证。所有内容显式标注「MOCK 仿真」，与真实模型输出不可混淆（AGENTS.md §8）。
 *
 * 剧本放在路由最前执行（与 /api/chat 同序）：不触碰模型探测，没有 key 也能跑通。
 */
import {
  classifyQuestions,
  type PaperQuestion,
} from '@/lib/diagnose/paper';
import { buildDiagnosisResult, parseSubmission } from '@/lib/diagnose/runtime';
import { encoder, sse } from '@/lib/sse';

/** 把固定剧本写进流：步骤、分组诊断、汇总与 done 全部按真实链路的 SSE 契约下发 */
export function runMockPaper(controller: ReadableStreamDefaultController<Uint8Array>): void {
  const step = (detail: string, extra?: Record<string, unknown>) =>
    controller.enqueue(encoder.encode(sse('paper_step', { step: detail, ...extra })));

  step('MOCK 仿真：切题完成（2 题）', { current: 1, total: 4 });
  const mockQuestions: PaperQuestion[] = [
    { number: '第1题', stem: '（MOCK 仿真）解方程 2x²-5x+1=0', answer: 'x=(5±√33)/4', type: '解答题' },
    { number: '第2题', stem: '（MOCK 仿真）求 y=1/(x-2) 的定义域', type: '填空题' },
  ];
  const groups = classifyQuestions(mockQuestions);
  step(`MOCK 仿真：分为 ${groups.length} 组`, { current: 2, total: 4 });
  let current = 2;
  for (const group of groups) {
    current += 1;
    step(`MOCK 仿真：诊断 ${group.questions.map((q) => q.number).join('、')}`, {
      current,
      total: groups.length + 3,
    });
    const parsed = parseSubmission({
      level: group.questions.some((q) => q.answer) ? 'L2' : 'L1',
      knowledgePoints: ['MOCK 仿真考点'],
      errorCause:
        group.code !== 'general'
          ? { code: group.code, confidence: 0.8 }
          : { code: 'calc_error', confidence: 0.7 },
      hints: [],
      notes: '（MOCK 仿真数据）',
    });
    if (parsed.ok) {
      controller.enqueue(
        encoder.encode(
          sse('diagnosis', {
            result: buildDiagnosisResult(parsed.value, {
              hasProblem: true,
              hasStudentAnswer: group.questions.some((q) => q.answer),
              hasCorrectAnswer: false,
              hasAnalysis: false,
            }),
            questionNumbers: group.questions.map((q) => q.number),
            groupCode: group.code,
          }),
        ),
      );
    }
  }
  step('MOCK 仿真：汇总', { current: groups.length + 3, total: groups.length + 3 });
  controller.enqueue(
    encoder.encode(
      sse('content', { delta: '（MOCK 仿真）整卷汇总：见上方各组卡片；剧本仅验证链路。' }),
    ),
  );
  controller.enqueue(
    encoder.encode(
      sse('done', {
        finishReason: 'paper',
        stats: { questions: mockQuestions.length, groups: groups.length, mock: true },
      }),
    ),
  );
}
