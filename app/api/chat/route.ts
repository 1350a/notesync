/**
 * POST /api/chat
 * 工具调用版（SSE 流式）。
 *
 * 协议（SSE，text/event-stream）：
 *   event: reasoning     data: {"delta":"思考过程增量"}
 *   event: content       data: {"delta":"回复内容增量"}
 *   event: tool_call     data: {"id":"...","name":"...","arguments":{...}}
 *   event: tool_result   data: {"id":"...","ok":true,"summary":"...","ms":12}
 *   event: awaiting_user data: {"questions":[...],"toolCallId":"..."}
 *   event: diagnosis     data: {"result":{...DiagnosisResult}}（仅诊断模式，在 done 之前下发）
 *   event: done          data: {"model":"...","provider":"...","usedRounds":1,"finishReason":"stop",
 *                            "diagnose":{"context":{...DiagnoseContext}}}（diagnose 仅诊断模式携带）
 *   event: error         data: {"code":"...","error":"..."}
 *
 * error.code 取值（前端据此区分提示口径，error 事件必有 code）：
 *   no_model        未配置任何可用模型
 *   invalid_model   请求的模型名不属于任何已配置 Provider（不再静默回落）
 *   unconfigured    归属 Provider 的 API_KEY / BASE_URL 缺失
 *   no_content      上传的附件全部提取失败，没有可发送的内容
 *   provider_error  上游返回错误（含 401 鉴权失败、模型不存在等；loop 未标注 code 时也兜底为此值）
 *   invalid_request 请求体不是合法 JSON（此前抛异常退化成框架 500，前端收不到 error 事件）
 *   parse_error     工具调用解析兜底失败（loop 内标注，见 doc/tool-protocol.md §5.3）
 *
 * 诊断模式附件：请求体可带 attachments（结构见 lib/diagnose/types.ts），
 * 服务端用 assembleDiagnoseMessage 组装成单条 user 消息追加在 messages 末尾；
 * 所选模型不支持图片（按模型判定）时，附件与聊天历史里的图片一并自动降级为文字占位，不做静默丢弃。
 * MOCK_MODEL=1 时不调用任何上游，只回显组装结构，用于零 token 验证发送数据。
 *
 * 诊断状态机：请求体可带 diagnose { context, event }（DiagnoseRequestPayload）。
 * 服务端按状态注入分阶段 system prompt（lib/diagnose/prompts.ts）并挂 submit_diagnosis 工具；
 * 响应后由 lib/diagnose/runtime.ts finalizeDiagnosis 做提交校验、guard 引用判据（重试一次）
 * 与状态推进，结果经 diagnosis 事件下发，最新上下文经 done.diagnose.context 回传客户端持久。
 * 缺省该字段即普通聊天，行为不变。
 *
 * 实现：按模型名归属路由到 Provider 后，委托 lib/tools/loop.ts 的 runToolLoop 编排，
 * 使用适配器屏蔽 native 与 text 模式的差异；任何异常均以 error 事件回传由前端展示。
 */
import {
  buildProviderMessages,
  explainProviderError,
  MAX_FILE_MESSAGES,
  MAX_IMAGE_MESSAGES,
  type ChatRequestBody,
} from '@/lib/chat/messages';
import { assembleDiagnoseMessage } from '@/lib/diagnose/assemble';
import { buildDiagnoseSystemPrompt } from '@/lib/diagnose/prompts';
import { isThinkingEffort } from '@/lib/settings/types';
import { parseAttachments } from '@/lib/diagnose/parse-attachments';
import {
  buildVerifyEvidence,
  finalizeDiagnosis,
  resolveDiagnoseSession,
  type LoopRunResult,
} from '@/lib/diagnose/runtime';
import { getModelList, resolveProvider } from '@/lib/provider';
import type { ProviderMessage } from '@/lib/provider/types';
import { estimateCost, logCost } from '@/lib/chat/cost';
import { trimMessages } from '@/lib/chat/trim';
import { mockStream } from '@/lib/mock/chat';
import { isBlockedSignal } from '@/lib/safety/block-detect';
import { MAX_ERROR_LOG_CHARS, redactUpstreamText } from '@/lib/safety/redact';
import { CHAT_BASE_SYSTEM_PROMPT, CONTENT_BLOCKED_MESSAGE } from '@/lib/safety/messages';
import { createAdapter } from '@/lib/tools/adapters';
import { registerBuiltinTools } from '@/lib/tools/builtin';
import { createSubmissionStore, createSubmitDiagnosisTool } from '@/lib/tools/builtin/submit_diagnosis';
import { runToolLoop } from '@/lib/tools/loop';
import { getEnabledTools } from '@/lib/tools/registry';
import type { ToolMode } from '@/lib/tools/types';
import {
  encoder,
  errorStream,
  readClientId,
  readJsonBody,
  sse,
  SSE_HEADERS,
} from '@/lib/sse';

// 确保内置工具注册
registerBuiltinTools();

/** 裁剪预算标签（日志用；trim.ts 的 resolveTrimBudget 是运行时值，这里只做展示） */
function resolveTrimBudgetLabel(): string {
  const parsed = parseInt(process.env.TRIM_BUDGET_CHARS || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : '24000(默认)';
}

export async function POST(request: Request) {
  // 匿名客户端标识（无登录体系的 user_id 替代，doc/user-settings.md §4）：
  // 仅日志追溯用，不参与路由/存储，服务端保持逐请求无状态
  const clientId = readClientId(request);
  console.log(`[chat] client=${clientId}`);

  // messages 元素可带 images（聊天界面上传的图片 dataUrl，组装成多模态内容）、
  // imageTexts（本地 OCR 转文字产物，非空时忽略 images 本体，任何模型可安全消费，
  // 见 doc/browser-local-ocr.md §6.2）与 files（聊天界面上传的纯文本文件，
  // 按 [文件 名字] 锚点拼进正文，纯文本模型同样可用）
  const parsedBody = await readJsonBody<ChatRequestBody>(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  // 本地链路验证开关：置 1 后不碰任何上游，只回显组装结构，便于零 token 校验发送数据
  if (process.env.MOCK_MODEL === '1') {
    return mockStream(parseAttachments(body.attachments), body);
  }

  const list = await getModelList();

  // 模型选择：请求指定模型优先；否则取可用列表首个模型
  const requested = body.model?.trim();
  const model: string | undefined = requested || list.models[0]?.name;
  if (!model) {
    return errorStream({
      code: "no_model",
      error:
        list.message ??
        "未配置任何可用模型：请复制 .env.example 为 .env.local，填写 DEEPSEEK_API_KEY / ZHIPU_API_KEY / CUSTOM_API_KEY+BASE_URL 三者之一后重启服务。",
    });
  }

  // 按模型名归属路由；无法归属直接报 invalid_model，不再静默回落到某家 provider
  const target = resolveProvider(model);
  if (!target) {
    return errorStream({
      code: "invalid_model",
      error: `模型「${model}」不属于任何已配置的 Provider。可先调用 GET /api/models 获取可用模型列表。${
        list.message ? `（${list.message}）` : ""
      }`,
      model,
      available: list.models.map((m) => m.name),
    });
  }
  const { provider } = target;

  // 归属 Provider 配置不全 → 明确错误
  if (!provider.isAvailable()) {
    return errorStream({
      code: "unconfigured",
      error: `模型「${model}」对应的 Provider（${provider.displayName}）配置不完整：请检查 .env.local 中的 API_KEY / BASE_URL。`,
      model,
      provider: provider.name,
    });
  }

  // 图片能力按所选模型判定（同 Provider 下模型能力可能不同，如智谱 glm-5.3 纯文本 / glm-5.3-flash 多模态）；
  // Provider 未实现按模型判定时回落 Provider 级 acceptsImages
  const allowImages = provider.modelAcceptsImages
    ? provider.modelAcceptsImages(model)
    : provider.acceptsImages !== false;

  // 组装发送给模型的消息：优先用显式 messages，否则用 content。
  // 纯文本模型时历史消息里的图片降级为文字占位，避免直传 image_url 被上游 400
  const { messages: builtMessages, droppedImageMessages, droppedFileMessages } =
    buildProviderMessages(body, { allowImages });
  if (droppedImageMessages > 0) {
    console.warn(
      `[chat] ${droppedImageMessages} 条较早消息的图片未随请求发送（超出 ${MAX_IMAGE_MESSAGES} 条上限，仅发送文字）`
    );
  }
  if (droppedFileMessages > 0) {
    console.warn(
      `[chat] ${droppedFileMessages} 条较早消息的文本文件未随请求发送（超出 ${MAX_FILE_MESSAGES} 条上限）`
    );
  }
  let providerMessages = builtMessages;

  // 诊断模式附件：组装成一条 user 消息追加在历史末尾；模型不吃图片时自动降级为文字占位
  const attachments = parseAttachments(body.attachments);
  if (attachments.length > 0) {
    const assembled = assembleDiagnoseMessage(attachments, {
      imageMode: allowImages ? 'multimodal' : 'text-only',
    });
    if (!assembled.message) {
      return errorStream({
        code: 'no_content',
        error: '上传的文件未提取到可用内容，请检查后重新上传。',
        model,
        provider: provider.name,
      });
    }
    providerMessages.push(assembled.message);
    for (const warning of assembled.warnings) {
      console.warn('[diagnose]', warning);
    }
  }

  // 诊断状态机会话：payload 解析 + 客户端事件应用（未携带 diagnose 字段则为普通聊天）
  const diagnose = resolveDiagnoseSession(body.diagnose, attachments);
  if (diagnose) {
    const verifyEvidence = buildVerifyEvidence(attachments);
    const systemPrompt = buildDiagnoseSystemPrompt({
      state: diagnose.context.state,
      ctx: diagnose.context,
      completeness: diagnose.completeness,
      verifyEvidence,
    });
    if (systemPrompt) {
      providerMessages.unshift({ role: 'system', content: systemPrompt });
    }
  } else if (providerMessages.length > 0) {
    // 普通聊天注入基础行为提示：软引导（§5.2）与关怀转介（§5.3）的模型侧承载；
    // 诊断模式不走此提示（离题由 reject 态处置，两套口径不叠加）
    providerMessages.unshift({ role: 'system', content: CHAT_BASE_SYSTEM_PROMPT });
  }

  // 工具配置判断
  const toolsEnabled = process.env.TOOLS_ENABLED !== 'false';
  const baseTools = toolsEnabled ? getEnabledTools() : [];
  const maxRounds = parseInt(process.env.TOOL_MAX_ROUNDS || '3', 10);
  // submit_diagnosis 是逐请求工厂件（提交存储随请求走，避免并发覆盖），不走注册表单例
  const submissionStore = createSubmissionStore();
  const tools = diagnose ? [...baseTools, createSubmitDiagnosisTool(submissionStore)] : baseTools;

  // 决定适配器模式（默认 native；custom 可以强制降级 text）
  let mode: ToolMode = 'native';
  if (provider.name === 'custom' && process.env.CUSTOM_TOOL_MODE === 'text') {
    mode = 'text';
  }
  const adapter = createAdapter(mode);

  // 清洗历史（如将上轮的 ask_user 调用痕迹转为普通文本）
  providerMessages = adapter.preprocessMessages(providerMessages);

  // 长会话上下文裁剪（总账 §9.1：不设硬边界，超预算从最旧一侧收口，最新一条用户消息永不裁）
  const trimResult = trimMessages(providerMessages);
  if (trimResult.trimmed) {
    console.warn(`[chat] 会话超预算，裁剪 ${trimResult.dropped} 条早期消息（预算 ${resolveTrimBudgetLabel()} 字符）`);
    providerMessages = trimResult.messages;
  }

  // guard 判据的学生文字来源之一：本轮最新一条用户消息正文（作答也可能打在对话里）
  const lastUserText = (() => {
    if (typeof body.content === 'string' && body.content.trim()) return body.content;
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].role === 'user') return msgs[i].content || '';
    }
    return '';
  })();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /**
       * 跑一次工具循环并转发流：done 持有不发（诊断后处理可能追加 diagnosis 事件，
       * done 必须保持终止符语义），正文累计供 guard 引用判据比对。
       * silent=true 时正文/思考增量不转发（补交轮专用：正文已流过一次），其余事件照常转发。
       * totalCalls 累计全部 pump 的循环轮数（含 finalize 重试），供成本计量。
       */
      let totalCalls = 0;
      const pump = async (
        messages: ProviderMessage[],
        runOpts?: { silent?: boolean },
      ): Promise<LoopRunResult> => {
        let outputText = '';
        let done: LoopRunResult['done'] = null;
        let awaitingUser = false;
        let failed = false;

        const generator = runToolLoop({
          model: model!,
          provider,
          messages,
          adapter,
          tools,
          maxRounds,
          signal: request.signal,
          // 上游拦截判定（两条路径：finish_reason 异常值 / 拒绝性文本，§3）
          blockedDetector: isBlockedSignal,
          // 上游终端用户标识（随机 UUID；safety-protocol §6）
          user: typeof body.user === 'string' && body.user.length <= 64 ? body.user : undefined,
          // 思考强度档位（doc/user-settings.md §2.1）：枚举外取值一律按未设置处理
          thinking: isThinkingEffort(body.thinkingEffort) ? body.thinkingEffort : undefined,
        });

        for await (const ev of generator) {
          // 防御：上游若仍下发空事件（undefined），直接跳过，避免取属性抛错导致整条 SSE 中断
          if (!ev) continue;
          if (ev.type === 'content') {
            outputText += ev.delta;
            if (!runOpts?.silent) {
              controller.enqueue(encoder.encode(sse('content', { delta: ev.delta })));
            }
          } else if (ev.type === 'reasoning') {
            if (!runOpts?.silent) {
              controller.enqueue(encoder.encode(sse('reasoning', { delta: ev.delta })));
            }
          } else if (ev.type === 'tool_call') {
            controller.enqueue(
              encoder.encode(
                sse('tool_call', { id: ev.id, name: ev.name, arguments: ev.arguments })
              )
            );
          } else if (ev.type === 'tool_result') {
            controller.enqueue(
              encoder.encode(
                sse('tool_result', { id: ev.id, ok: ev.ok, summary: ev.summary, ms: ev.ms })
              )
            );
          } else if (ev.type === 'awaiting_user') {
            awaitingUser = true;
            controller.enqueue(
              encoder.encode(
                sse('awaiting_user', { questions: ev.questions, toolCallId: ev.toolCallId })
              )
            );
          } else if (ev.type === 'done') {
            done = { usedRounds: ev.usedRounds, finishReason: ev.finishReason };
            totalCalls += ev.usedRounds;
          } else if (ev.type === 'error') {
            failed = true;
            controller.enqueue(
              encoder.encode(
                sse('error', {
                  // loop 已标注 code（parse_error/provider_error）则透传；未标注按模型请求失败兜底
                  code: ev.code ?? 'provider_error',
                  // loop 的 message 可能夹带上游原文，这里统一过一遍脱敏（审查项 S2）
                  error: explainProviderError(redactUpstreamText(ev.message) || '模型请求失败'),
                  model,
                  provider: provider.name,
                })
              )
            );
          } else if (ev.type === 'blocked') {
            // 上游拦截：循环已丢弃本轮历史（§3.1），这里归一为 content_blocked 通知；
            // 客户端据此丢弃已流出片段并展示固定说明（不重试——重试只会再被拦一次，§2）
            failed = true;
            controller.enqueue(
              encoder.encode(
                sse('error', {
                  code: 'content_blocked',
                  error: CONTENT_BLOCKED_MESSAGE,
                  model,
                  provider: provider.name,
                })
              )
            );
          }
        }
        return { outputText, done, awaitingUser, failed };
      };

      try {
        const mainRun = await pump(providerMessages);

        // 诊断后处理：提交补交 / guard 重试由 finalize 编排（补交轮正文静默不转发、
        // guard 重试段照常流式转发），随后统一发 diagnosis 与 done；awaiting_user / 失败轮不做后处理
        if (diagnose && mainRun.done && !mainRun.awaitingUser && !mainRun.failed) {
          const fin = await finalizeDiagnosis({
            session: diagnose,
            baseMessages: providerMessages,
            mainRun,
            attachments,
            submissionStore,
            lastUserText,
            runLoop: pump,
          });
          diagnose.context = fin.context;
          if (fin.diagnosis) {
            controller.enqueue(encoder.encode(sse('diagnosis', { result: fin.diagnosis })));
          }
        }

        if (mainRun.done) {
          controller.enqueue(
            encoder.encode(
              sse('done', {
                model,
                provider: provider.name,
                usedRounds: mainRun.done.usedRounds,
                finishReason: mainRun.done.finishReason,
                ...(diagnose ? { diagnose: { context: diagnose.context } } : {}),
              })
            )
          );
          // 成本计量（总账 §9.1）：调用次数精确（含 finalize 重试的循环轮数），token 走字符估算区间
          logCost(
            estimateCost({
              route: '/api/chat',
              clientId,
              calls: totalCalls,
              messages: providerMessages,
            }),
          );
        }
      } catch (err) {
        // 异常原文只进服务端日志，响应给脱敏摘要（审查项 S2）
        const rawError = err instanceof Error ? err.message : String(err ?? "");
        if (rawError) {
          console.error(`[chat] 模型请求失败：${rawError.slice(0, MAX_ERROR_LOG_CHARS)}`);
        }
        controller.enqueue(
          encoder.encode(
            sse("error", {
              code: "provider_error",
              error: explainProviderError(
                redactUpstreamText(rawError) || "模型请求失败"
              ),
              model,
              provider: provider.name,
            })
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
