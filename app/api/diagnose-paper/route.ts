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
import { assembleDiagnoseMessage, resolveAssembleImageMode } from '@/lib/diagnose/assemble';
import { parseAttachments } from '@/lib/diagnose/parse-attachments';
import {
  buildGroupDiagnosePrompt,
  buildSplitPrompt,
  buildSummaryPrompt,
  classifyQuestions,
  parseJsonLoose,
  parseSplitResultDetailed,
  type PaperQuestion,
  type SplitFailureReason,
} from '@/lib/diagnose/paper';
import { runMockPaper } from '@/lib/mock/paper';
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
import { MAX_ERROR_LOG_CHARS, redactUpstreamText } from '@/lib/safety/redact';
import { estimateCost, logCost } from '@/lib/chat/cost';
import {
  encoder,
  readClientId,
  readJsonBody,
  sse,
  SSE_HEADERS,
} from '@/lib/sse';

/**
 * 切题失败文案：按失败原因分层。只有真正的版面问题才提「模糊/过密」，
 * JSON 不合法、空数组、题干缺失各自给可操作的下一步（§5.2 宁可少做不可错做）。
 */
const SPLIT_FAILURE_MESSAGES: Record<SplitFailureReason, string> = {
  not_json: '模型没有返回可解析的切题结果（未按 JSON 列表输出）。请改用单题模式逐题上传，或重新发起整卷诊断。',
  not_array: '模型返回的切题结果不是题目列表。请改用单题模式逐题上传，或重新发起整卷诊断。',
  empty: '模型没有从材料中切出任何题目（题面可能未被模型读取到）。请确认上传的卷面清晰完整后重试，或改用单题模式。',
  no_stem: '模型切题结果里没有可用的题干（题面未成功转写）。请提供更清晰的文件后重试，或改用单题模式。',
};

/**
 * 四步流程的固定阶段数（①切题 ②分类 ③分组诊断 ④汇总）。
 * 只用于「阶段 i/4」这一阶段口径的展示，与上传文件数、题目数无关；
 * 分组阶段用另一套分母「第 i/N 组」，两种口径不可横向比较（doc/diagnose-paper.md）。
 */
const STAGE_TOTAL = 4;

interface GroupConclusion {
  code: ReturnType<typeof classifyQuestions>[number]['code'];
  result: DiagnosisResult;
  members: PaperQuestion[];
}

export async function POST(request: Request) {
  const clientId = readClientId(request);
  console.log(`[paper] client=${clientId}`);
  type PaperBody = { model?: unknown; attachments?: unknown; user?: unknown };
  const parsedBody = await readJsonBody<PaperBody>(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;
  const attachments = parseAttachments(body.attachments);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const step = (detail: string, extra?: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(sse('paper_step', { step: detail, ...extra })));
      /**
       * 失败收尾：先补一条明示终态的 paper_step（`status:'failed'`），前端据此把已有步骤
       * 标为已中断，不再让「切题中…」一直挂着；再发 error。凡是 error 终止都必须走这里。
       */
      const fail = (
        code: string,
        error: string,
        stageLabel: string,
        errorExtra?: Record<string, unknown>,
      ) => {
        step(`${stageLabel}（流程已中断）`, { status: 'failed' });
        controller.enqueue(encoder.encode(sse('error', { code, error, ...errorExtra })));
      };
      try {
        if (attachments.length === 0) {
          fail('no_content', '没有可发送的内容，请先上传试卷文件。', '未开始');
          return;
        }

        // MOCK 剧本在最前（与 /api/chat 同序）：不触碰模型探测，零 token 可走通
        if (process.env.MOCK_MODEL === '1') {
          runMockPaper(controller);
          return;
        }

        // 模型解析：与 /api/chat 同一套路（请求指定优先，否则首个可用；无静默回落）
        const list = await getModelList();
        const requested = typeof body.model === 'string' ? body.model.trim() : '';
        const model = requested || list.models[0]?.name;
        if (!model) {
          fail('no_model', list.message ?? '未配置任何可用模型。', '未开始');
          return;
        }
        const target = resolveProvider(model);
        if (!target || !target.provider.isAvailable()) {
          fail('invalid_model', `模型「${model}」不可用，请检查 Provider 配置。`, '未开始');
          return;
        }
        const provider: LLMProvider = target.provider;
        const user = typeof body.user === 'string' && body.user.length <= 64 ? body.user : undefined;
        const allowImages = provider.modelAcceptsImages
          ? provider.modelAcceptsImages(model)
          : provider.acceptsImages !== false;

        const imageMode = resolveAssembleImageMode(attachments, allowImages);
        const assembled = assembleDiagnoseMessage(attachments, { imageMode });
        if (!assembled.message) {
          fail('no_content', '附件未提取到可用内容，请检查后重新上传。', '取材失败');
          return;
        }
        // 切题取材前置校验：既没有图片本体（模型不收图 / 未直传）又没有文本时，切题必然空跑。
        // 这是配置或取材问题，先按 no_text_material 说清楚，不混进「拍照模糊」的文案。
        if (assembled.stats.images === 0 && assembled.stats.chars === 0) {
          console.warn(
            `[paper] 无可用切题材料 model=${model} provider=${provider.name} imageMode=${imageMode} allowImages=${allowImages}`,
          );
          fail(
            'no_text_material',
            '材料中没有可供识别题目的文字或图片：当前模型不接收图片本体，附件也未完成 OCR 转写。请先开启 OCR 或改用支持图片输入的模型后重试整卷。',
            '取材失败',
          );
          return;
        }
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
            fail('content_blocked', CONTENT_BLOCKED_MESSAGE, '内容被拦截', {
              model,
              provider: provider.name,
            });
            return null;
          }
          return result.content;
        };

        // ① 切题（携带组装好的多模态消息：图片本体随 parts 上行，不再拍平成「[图片]」占位）
        step('切题中…', { progress: `阶段 1/${STAGE_TOTAL}` });
        const splitRaw = await complete(
          [
            { role: 'system', content: buildSplitPrompt() },
            assembled.message,
          ],
          true,
        );
        if (splitRaw === null) return; // 已被拦截
        const split = parseSplitResultDetailed(splitRaw);
        if (!split.ok) {
          // §5.2：切题失败不静默继续，宁可少做不可错做；失败原因与原始输出（脱敏截断）留在服务端
          console.warn(
            `[paper] 切题失败 reason=${split.reason} model=${model} raw=${redactUpstreamText(splitRaw)}`,
          );
          fail('provider_error', SPLIT_FAILURE_MESSAGES[split.reason], '切题失败');
          return;
        }
        const questions = split.questions;
        step(`切题完成：${questions.length} 题`, {
          progress: `阶段 1/${STAGE_TOTAL}`,
          detail: `${questions.length} 题`,
        });

        // ② 分类（本地规则，零 token）
        const groups = classifyQuestions(questions);
        step(`分为 ${groups.length} 组（同类共享诊断）`, { progress: `阶段 2/${STAGE_TOTAL}` });

        // ③ 同组共享诊断
        const conclusions: GroupConclusion[] = [];
        let groupIndex = 0;
        for (const group of groups) {
          groupIndex += 1;
          // 分组阶段的进度用「第 i/N 组」口径，与阶段口径（阶段 i/4）分开，避免分母混读
          step(`诊断题号 ${group.questions.map((q) => q.number).join('、')}`, {
            progress: `第 ${groupIndex}/${groups.length} 组`,
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
            step(`组 ${group.code} 诊断未完成（已跳过）`, { progress: `第 ${groupIndex}/${groups.length} 组` });
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
          fail('no_content', '所有分组诊断均未完成，请重试或改用单题模式。', '诊断失败');
          return;
        }
        step('汇总中…', { progress: `阶段 4/${STAGE_TOTAL}` });
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
        // chars 口径 = 文本字符 + 图片张数：原图直传档没有文本，按每张 1 字符占位，
        // 避免 requestChars 恒为 0（图片本体不计字符，但确实进了请求）
        logCost(
          estimateCost({
            route: '/api/diagnose-paper',
            clientId,
            calls: groups.length + 2,
            messages: [assembled.message],
            requestChars: assembled.stats.chars + assembled.stats.images,
          }),
        );
      } catch (err) {
        // 上游异常原文只进服务端日志，响应给脱敏摘要（审查项 S2）
        const raw = err instanceof Error ? err.message : String(err ?? '');
        if (raw) console.error(`[paper] 整卷诊断请求失败：${raw.slice(0, MAX_ERROR_LOG_CHARS)}`);
        const summary = redactUpstreamText(raw);
        fail(
          'provider_error',
          summary ? `整卷诊断请求失败：${summary}` : '整卷诊断请求失败，请稍后重试。',
          '诊断失败',
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
