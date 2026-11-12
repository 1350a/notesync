/**
 * POST /api/diagnose-paper — 整卷诊断四步流程（agent-workflow.md §5）
 *
 * ① 切题（1 次调用，结构化 JSON）→ ② 分类（本地关键词规则，零 token）→
 * ③ 同类共享诊断（按错因组数计调用，复用 submit_diagnosis 的提交结构）→ ④ 汇总（1 次调用）。
 * 调用预算 = 组数 + 2。
 *
 * SSE 事件：
 *   paper_step  {step, detail?, current?, total?}   步骤/组进度
 *   diagnosis   {result, questionNumbers, groupCode} 每组共享诊断结论（复用单题卡片渲染）
 *   content     {delta}                              汇总正文
 *   error       {code, error}                        失败（content_blocked 语义与 /api/chat 一致）
 *   done        {finishReason:"paper", stats}
 *
 * 降级语义（§5.2 宁可少做不可错做）：切题失败→明确提示改用单题模式，不静默继续；
 * 单组诊断失败→跳过该组并在步骤里留痕，不阻断其他组。
 * MOCK_MODEL=1：固定剧本零 token 走通全流程（内容标注「MOCK 仿真」）。
 */
import { assembleDiagnoseMessage } from '@/lib/diagnose/assemble';
import { parseAttachments } from '@/lib/diagnose/parse-attachments';
import {
  buildGroupDiagnosePrompt,
  buildSplitPrompt,
  buildSummaryPrompt,
  classifyQuestions,
  parseJsonLoose,
  parseSplitResult,
  type PaperQuestion,
} from '@/lib/diagnose/paper';
import { isBlockedSignal } from '@/lib/safety/block-detect';
import { getModelList, resolveProvider } from '@/lib/provider';
import type { LLMProvider, ProviderMessage } from '@/lib/provider/types';
import {
  buildDiagnosisResult,
  parseSubmission,
} from '@/lib/diagnose/runtime';
import { deriveCompleteness } from '@/lib/diagnose/completeness';
import type { DiagnosisResult } from '@/lib/diagnose/types';
import { CONTENT_BLOCKED_MESSAGE } from '@/lib/safety/messages';
import { estimateCost, logCost } from '@/lib/chat/cost';

const encoder = new TextEncoder();

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 从组装消息提取可读文本（切题/汇总提示词用；图片以占位计入，多模态时本体随消息上行） */
function materialText(message: ProviderMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((part) => (part.type === 'text' ? part.text : '[图片]'))
    .join('\n\n');
}

interface GroupConclusion {
  code: ReturnType<typeof classifyQuestions>[number]['code'];
  result: DiagnosisResult;
  members: PaperQuestion[];
}

export async function POST(request: Request) {
  const clientId = request.headers.get('x-client-id') ?? 'anonymous';
  console.log(`[paper] client=${clientId}`);
  const body = (await request.json()) as { model?: unknown; attachments?: unknown; user?: unknown };
  const attachments = parseAttachments(body.attachments);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const step = (detail: string, extra?: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(sse('paper_step', { step: detail, ...extra })));
      try {
        if (attachments.length === 0) {
          controller.enqueue(
            encoder.encode(sse('error', { code: 'no_content', error: '没有可发送的内容，请先上传试卷文件。' })),
          );
          return;
        }

        // MOCK 剧本在最前（与 /api/chat 同序）：不触碰模型探测，零 token 可走通
        if (process.env.MOCK_MODEL === '1') {
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
                group.code !== 'general' ? { code: group.code, confidence: 0.8 } : { code: 'calc_error', confidence: 0.7 },
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
            encoder.encode(sse('content', { delta: '（MOCK 仿真）整卷汇总：见上方各组卡片；剧本仅验证链路。' })),
          );
          controller.enqueue(
            encoder.encode(
              sse('done', {
                finishReason: 'paper',
                stats: { questions: mockQuestions.length, groups: groups.length, mock: true },
              }),
            ),
          );
          return;
        }

        // 模型解析：与 /api/chat 同一套路（请求指定优先，否则首个可用；无静默回落）
        const list = await getModelList();
        const requested = typeof body.model === 'string' ? body.model.trim() : '';
        const model = requested || list.models[0]?.name;
        if (!model) {
          controller.enqueue(
            encoder.encode(sse('error', { code: 'no_model', error: list.message ?? '未配置任何可用模型。' })),
          );
          return;
        }
        const target = resolveProvider(model);
        if (!target || !target.provider.isAvailable()) {
          controller.enqueue(
            encoder.encode(
              sse('error', { code: 'invalid_model', error: `模型「${model}」不可用，请检查 Provider 配置。` }),
            ),
          );
          return;
        }
        const provider: LLMProvider = target.provider;
        const user = typeof body.user === 'string' && body.user.length <= 64 ? body.user : undefined;
        const allowImages = provider.modelAcceptsImages
          ? provider.modelAcceptsImages(model)
          : provider.acceptsImages !== false;

        const assembled = assembleDiagnoseMessage(attachments, {
          imageMode: allowImages ? 'multimodal' : 'text-only',
        });
        if (!assembled.message) {
          controller.enqueue(
            encoder.encode(sse('error', { code: 'no_content', error: '附件未提取到可用内容，请检查后重新上传。' })),
          );
          return;
        }
        const material = materialText(assembled.message);
        const completeness = deriveCompleteness(attachments);
        const hasStudentAnswer = completeness.hasStudentAnswer;

        /** 单次补全 + 拦截归一；返回 content 或 null（null=已被拦截，error 事件已发） */
        const complete = async (messages: ProviderMessage[], json: boolean): Promise<string | null> => {
          if (!provider.completeDetailed) {
            throw new Error('当前 Provider 不支持补全调用');
          }
          const result = await provider.completeDetailed({
            model,
            messages,
            json: json || undefined,
            user,
            signal: request.signal,
          });
          if (isBlockedSignal({ finishReason: result.finishReason, text: result.content })) {
            controller.enqueue(
              encoder.encode(
                sse('error', {
                  code: 'content_blocked',
                  error: CONTENT_BLOCKED_MESSAGE,
                  model,
                  provider: provider.name,
                }),
              ),
            );
            return null;
          }
          return result.content;
        };

        // ① 切题
        step('切题中…', { current: 1, total: 4 });
        const splitRaw = await complete(
          [
            { role: 'system', content: buildSplitPrompt() },
            { role: 'user', content: material },
          ],
          true,
        );
        if (splitRaw === null) return; // 已被拦截
        const questions = parseSplitResult(splitRaw);
        if (!questions) {
          // §5.2：切题失败不静默继续，宁可少做不可错做
          controller.enqueue(
            encoder.encode(
              sse('error', {
                code: 'provider_error',
                error: '未能从材料中切分出题目（可能拍照模糊或排版过密）。请改用单题模式逐题上传，或提供更清晰的文件后再试整卷。',
              }),
            ),
          );
          return;
        }
        step(`切题完成：${questions.length} 题`, { current: 1, total: 4, detail: `${questions.length} 题` });

        // ② 分类（本地规则，零 token）
        const groups = classifyQuestions(questions);
        step(`分为 ${groups.length} 组（同类共享诊断）`, { current: 2, total: 4 });

        // ③ 同组共享诊断
        const conclusions: GroupConclusion[] = [];
        let groupIndex = 0;
        for (const group of groups) {
          groupIndex += 1;
          step(`诊断第 ${groupIndex}/${groups.length} 组：${group.questions.map((q) => q.number).join('、')}`, {
            current: groupIndex,
            total: groups.length,
          });
          const raw = await complete(
            [
              {
                role: 'user',
                content: buildGroupDiagnosePrompt({
                  code: group.code,
                  representative: group.questions[0],
                  members: group.questions,
                  hasStudentAnswer,
                }),
              },
            ],
            true,
          );
          if (raw === null) return; // 已被拦截
          const parsed = parseSubmission(parseJsonLoose(raw));
          if (!parsed.ok) {
            // 单组失败留痕跳过，不阻断其他组
            console.warn(`[paper] 组 ${group.code} 提交校验失败：${parsed.reason}`);
            step(`组 ${group.code} 诊断未完成（已跳过）`);
            continue;
          }
          const result = buildDiagnosisResult(parsed.value, { ...completeness, hasProblem: true });
          conclusions.push({ code: group.code, result, members: group.questions });
          controller.enqueue(
            encoder.encode(
              sse('diagnosis', {
                result,
                questionNumbers: group.questions.map((q) => q.number),
                groupCode: group.code,
              }),
            ),
          );
        }

        // ④ 汇总
        if (conclusions.length === 0) {
          controller.enqueue(
            encoder.encode(sse('error', { code: 'no_content', error: '所有分组诊断均未完成，请重试或改用单题模式。' })),
          );
          return;
        }
        step('汇总中…', { current: 4, total: 4 });
        const summary = await complete([{ role: 'user', content: buildSummaryPrompt(conclusions) }], false);
        if (summary === null) return; // 已被拦截
        controller.enqueue(encoder.encode(sse('content', { delta: summary })));
        controller.enqueue(
          encoder.encode(
            sse('done', {
              finishReason: 'paper',
              stats: { questions: questions.length, groups: groups.length },
            }),
          ),
        );
        // 成本计量（总账 §9.1）：切题 1 + 组数 + 汇总 1
        logCost(
          estimateCost({
            route: '/api/diagnose-paper',
            clientId,
            calls: groups.length + 2,
            messages: [{ content: material }],
          }),
        );
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sse('error', {
              code: 'provider_error',
              error: err instanceof Error ? err.message : '整卷诊断请求失败',
            }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
