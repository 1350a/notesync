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
import { findStrategyCard, STRATEGY_VERSION } from '@/lib/diagnose/strategies';
import { transition } from '@/lib/diagnose/state-machine';
import {
  buildVerifyEvidence,
  finalizeDiagnosis,
  resolveDiagnoseSession,
  type LoopRunResult,
} from '@/lib/diagnose/runtime';
import type {
  DiagnoseAttachment,
  DiagnoseContext,
  DiagnosisResult,
  ReviseCategory,
} from '@/lib/diagnose/types';
import type { AskUserQuestion } from '@/lib/tools/types';
import { getModelList, resolveProvider } from '@/lib/provider';
import type { ProviderMessage } from '@/lib/provider/types';
import { isBlockedSignal } from '@/lib/safety/block-detect';
import { CHAT_BASE_SYSTEM_PROMPT, CONTENT_BLOCKED_MESSAGE } from '@/lib/safety/messages';
import { createAdapter } from '@/lib/tools/adapters';
import { registerBuiltinTools } from '@/lib/tools/builtin';
import { createSubmissionStore, createSubmitDiagnosisTool } from '@/lib/tools/builtin/submit_diagnosis';
import { runToolLoop } from '@/lib/tools/loop';
import { getEnabledTools } from '@/lib/tools/registry';
import type { ToolMode } from '@/lib/tools/types';

const encoder = new TextEncoder();

// 确保内置工具注册
registerBuiltinTools();

/** 封装一条 SSE 事件为字节流 */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

/** 直接返回单条 error 事件的流（用于请求前校验失败） */
function errorStream(data: {
  code: "invalid_model" | "unconfigured" | "provider_error" | "no_model" | "no_content";
  error: string;
  model?: string;
  provider?: string;
  available?: string[];
}): Response {
  return new Response(sse("error", data), { headers: SSE_HEADERS });
}

const CATEGORIES = new Set<ReviseCategory>(["origin", "wrong", "correct", "analysis"]);

/** 单张图片 dataUrl 上限（约 9MB 原图），超出直接丢弃，防止请求体撑爆内存 */
const MAX_DATA_URL = 12 * 1024 * 1024;

/**
 * 校验前端上传的 attachments。
 * 非法项一律丢弃（附 console.warn 便于排查），不因一条脏数据让整批诊断失败。
 */
function parseAttachments(raw: unknown): DiagnoseAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: DiagnoseAttachment[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const category = record.category;
    if (!name || typeof category !== "string" || !CATEGORIES.has(category as ReviseCategory)) {
      console.warn("[diagnose] 丢弃非法附件：缺少文件名或分类不属于四类标签");
      continue;
    }

    const rawUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
    const dataUrl = rawUrl.startsWith("data:image/") ? rawUrl : undefined;
    if (rawUrl && !dataUrl) {
      console.warn(`[diagnose] ${name}：dataUrl 不是图片数据，已忽略`);
    }
    if (dataUrl && dataUrl.length > MAX_DATA_URL) {
      console.warn(`[diagnose] ${name}：图片超过 ${MAX_DATA_URL} 字符上限，已忽略`);
      continue;
    }

    const text = typeof record.text === "string" ? record.text : undefined;
    if (!dataUrl && !text?.trim()) {
      console.warn(`[diagnose] ${name}：既无图片也无文字内容，已忽略`);
      continue;
    }

    out.push({
      name,
      category: category as ReviseCategory,
      dataUrl,
      text,
      warning: typeof record.warning === "string" ? record.warning : undefined,
    });
  }

  return out;
}

/** 把组装结果渲染成可读摘要（MOCK 专用，不回显 base64 本体） */
function summarizeForMock(
  result: ReturnType<typeof assembleDiagnoseMessage>
): string {
  const content = result.message?.content;
  const parts = Array.isArray(content) ? content : [];
  const rows = parts.map((part, index) => {
    if (part.type === "text") {
      const preview = part.text.replace(/\s+/g, " ").slice(0, 48);
      return `| ${index + 1} | text | ${part.text.length} | ${preview} |`;
    }
    const url = part.image_url.url;
    const head = url.slice(0, 24);
    return `| ${index + 1} | image_url | ${url.length} | ${head}… |`;
  });

  const lines = [
    "> MOCK 模式：未调用任何模型，以下为实际组装出来的发送结构。",
    "",
    `- 消息条数：1（role=user）`,
    `- part 数：${parts.length}（图片 ${result.stats.images} / 文本 ${result.stats.texts}）`,
    `- 文本字符数：${result.stats.chars}`,
    "",
    "| # | 类型 | 长度 | 预览 |",
    "| --- | --- | --- | --- |",
    ...rows,
  ];

  if (result.warnings.length > 0) {
    lines.push("", "**降级与告警**", ...result.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}

/** MOCK 模式下的聊天消息摘要：只回显每条消息的内容形态，不回显 base64 本体 */
function summarizeChatMessages(messages: ProviderMessage[]): string {
  const rows = messages.map((m, index) => {
    if (typeof m.content === 'string') {
      const preview = m.content.replace(/\s+/g, ' ').slice(0, 48);
      return `| ${index + 1} | ${m.role} | text | ${m.content.length} | ${preview} |`;
    }
    const images = m.content.filter((part) => part.type === 'image_url').length;
    const texts = m.content.length - images;
    const preview = m.content
      .filter((part) => part.type === 'text')
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 32);
    return `| ${index + 1} | ${m.role} | 多模态（图片 ${images} / 文本 ${texts}） | - | ${preview} |`;
  });
  return [
    '> MOCK 模式：未调用任何模型，以下为 messages 实际组装结构。',
    '',
    '| # | 角色 | 内容形态 | 字符数 | 预览 |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/**
 * MOCK 诊断仿真剧本：按当前状态给出一轮固定输出，让诊断卡片、掌握度回路、ask_user 中断
 * 与状态机推进在零 token 下完整走通（UI 验证/演示彩排用，不依赖任何 API key）。
 * 所有内容显式标注「MOCK 仿真」，与真实模型输出不可混淆（AGENTS.md §8）。
 */
function mockDiagnosisScript(
  session: NonNullable<ReturnType<typeof resolveDiagnoseSession>>,
  hasAttachments: boolean,
): {
  content: string;
  diagnosis?: DiagnosisResult;
  awaitingQuestions?: AskUserQuestion[];
  nextContext: DiagnoseContext;
} {
  const { context, completeness } = session;
  // 聊天链路下 MOCK 扮演「模型判定」：有题无作答；附件链路沿用真实推导
  const simulatedCompleteness = hasAttachments
    ? completeness
    : { ...completeness, hasProblem: true, hasStudentAnswer: context.state !== 'intake' };
  const tag = '（MOCK 仿真）';

  switch (context.state) {
    case 'intake': {
      const diagnosis: DiagnosisResult = {
        subject: 'math',
        level: 'L1',
        completeness: simulatedCompleteness,
        knowledgePoints: ['一元二次方程', '判别式与求根公式'],
        errorCause: null,
        strategy: null,
        hints: [{ level: 1, content: `${tag}这题考判别式符号与求根公式的适用。` }],
        notes: simulatedCompleteness.hasStudentAnswer ? undefined : '未提供作答，本次不做错因归因。',
        strategyVersion: STRATEGY_VERSION,
      };
      const next = transition(context, { type: 'intake_done', hasProblem: true, isMath: true }).context;
      const nextContext = simulatedCompleteness.hasStudentAnswer
        ? transition(next, { type: 'clarify_done', hasAnswer: true, refused: false }).context
        : next;
      return {
        content: `${tag}L1 题目画像：考点是判别式与求根公式；常见错法见下方卡片（固定剧本，仅验证链路）。`,
        diagnosis,
        nextContext,
      };
    }
    case 'clarify':
      return {
        content: '',
        awaitingQuestions: [
          {
            label: 'MOCK 补问',
            question: `${tag}这道题常见的错法是 A. 公式记错 B. 计算失误 C. 隐含条件遗漏，你是哪一种，还是都不确定？`,
            options: ['A. 公式记错', 'B. 计算失误', 'C. 隐含条件遗漏', '都不确定'],
          },
        ],
        nextContext: context,
      };
    case 'diagnose': {
      const diagnosis: DiagnosisResult = {
        subject: 'math',
        level: 'L2',
        completeness: simulatedCompleteness,
        knowledgePoints: ['判别式与求根公式'],
        errorCause: { code: 'formula_misuse', confidence: 0.82 },
        secondaryErrorCause: { code: 'calc_error', confidence: 0.31 },
        strategy: findStrategyCard('formula_misuse'),
        hints: [{ level: 1, content: `${tag}先确认判别式公式本身的符号。` }],
        notes: '（MOCK 仿真数据，用于验证卡片与回路渲染）',
        strategyVersion: STRATEGY_VERSION,
      };
      return {
        content: `${tag}你写的 Δ = b² + 4ac 这步存在公式误用——判别式应为 b² − 4ac（固定剧本，仅验证链路）。`,
        diagnosis,
        nextContext: transition(context, { type: 'diagnosis_done', outcome: 'confident' }).context,
      };
    }
    case 'explain': {
      const levelText: Record<1 | 2 | 3, string> = {
        1: '定位：这题考判别式符号与求根公式。',
        2: '方向：先核对公式再代数计算。',
        3: '关键步骤：Δ = b² − 4ac 的展开与符号。',
      };
      return {
        content: `${tag}提示阶梯第 ${context.hintLevel} 级——${levelText[context.hintLevel]}`,
        nextContext: context,
      };
    }
    case 'L1_only':
      return {
        content: `${tag}L1 题目画像 + 声明：未能进行错因归因。`,
        diagnosis: {
          subject: 'math',
          level: 'L1',
          completeness: simulatedCompleteness,
          knowledgePoints: ['一元二次方程'],
          errorCause: null,
          strategy: null,
          hints: [],
          notes: '未能定位具体断点，本次不做错因归因。',
          strategyVersion: STRATEGY_VERSION,
        },
        nextContext: transition(context, { type: 'output_done' }).context,
      };
    case 'reject':
      return {
        content: `${tag}本系统当前仅支持数学错题诊断。`,
        nextContext: transition(context, { type: 'output_done' }).context,
      };
    case 'done':
      return { content: `${tag}收尾：有新的错题随时发来。`, nextContext: context };
  }
}

/** MOCK 响应流：不解析模型，直接回显组装摘要 */
function mockStream(attachments: DiagnoseAttachment[], body: ChatRequestBody): Response {
  const assembled = assembleDiagnoseMessage(attachments, {
    imageMode: process.env.MOCK_IMAGE_MODE === "text-only" ? "text-only" : "multimodal",
  });
  const { messages: chatMessages } = buildProviderMessages(body);
  const hasChatContent = chatMessages.some((m) =>
    typeof m.content === 'string' ? m.content.trim().length > 0 : m.content.length > 0
  );

  // 诊断模式零 token 摘要：回显状态机上下文、完整度与注入的系统提示词规模
  const diagnoseSession = resolveDiagnoseSession(body.diagnose, attachments);
  const diagnoseBlock = diagnoseSession
    ? [
        '',
        '**诊断模式（MOCK 摘要）**',
        `- 状态机: ${diagnoseSession.context.state}（追问已用 ${diagnoseSession.context.clarifyUsed} 次，阶梯 L${diagnoseSession.context.hintLevel}）`,
        `- 完整度: ${JSON.stringify(diagnoseSession.completeness)}${
          attachments.length > 0
            ? '（来源：四类附件推导）'
            : '（来源：四类附件推导；本请求无附件，聊天页输入的完整度由模型在 intake 判定，MOCK 下不跑模型故全 false）'
        }`,
        `- 机械判定证据: ${buildVerifyEvidence(attachments) || '（无，缺少成对的 wrong/correct 文本）'}`,
        `- 分状态系统提示词: ${
            buildDiagnoseSystemPrompt({
              state: diagnoseSession.context.state,
              ctx: diagnoseSession.context,
              completeness: diagnoseSession.completeness,
              verifyEvidence: buildVerifyEvidence(attachments),
            })?.length ?? 0
          } 字符`,
      ].join('\n')
    : '';

  // 诊断模式仿真剧本：让卡片/回路/状态推进在 MOCK 下可完整走通（零 token UI 验证）
  const script = diagnoseSession ? mockDiagnosisScript(diagnoseSession, attachments.length > 0) : null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 纯聊天请求（无诊断附件）：回显 messages 组装结构，便于零 token 校验图片是否真的进了请求
      if (attachments.length === 0) {
        if (!hasChatContent) {
          controller.enqueue(
            encoder.encode(sse('error', { code: 'no_content', error: '请求里没有可发送的内容。' }))
          );
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(sse('content', { delta: summarizeChatMessages(chatMessages) + diagnoseBlock })));
        if (script) {
          if (script.content) {
            controller.enqueue(encoder.encode(sse('content', { delta: `\n\n---\n\n${script.content}` })));
          }
          if (script.diagnosis) {
            controller.enqueue(encoder.encode(sse('diagnosis', { result: script.diagnosis })));
          }
          if (script.awaitingQuestions) {
            controller.enqueue(
              encoder.encode(
                sse('awaiting_user', { questions: script.awaitingQuestions, toolCallId: 'mock-ask-user' })
              )
            );
          }
        }
        controller.enqueue(
          encoder.encode(
            sse('done', {
              model: 'mock',
              provider: 'mock',
              usedRounds: 0,
              finishReason: script?.awaitingQuestions ? 'awaiting_user' : 'mock',
              ...(script ? { diagnose: { context: script.nextContext } } : {}),
            })
          )
        );
        controller.close();
        return;
      }
      if (!assembled.message) {
        controller.enqueue(
          encoder.encode(
            sse("error", {
              code: "no_content",
              error: "上传的文件未提取到可用内容，请检查后重新上传。",
            })
          )
        );
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(sse("content", { delta: summarizeForMock(assembled) + diagnoseBlock })));
      if (script) {
        if (script.content) {
          controller.enqueue(encoder.encode(sse("content", { delta: `\n\n---\n\n${script.content}` })));
        }
        if (script.diagnosis) {
          controller.enqueue(encoder.encode(sse("diagnosis", { result: script.diagnosis })));
        }
        if (script.awaitingQuestions) {
          controller.enqueue(
            encoder.encode(
              sse("awaiting_user", { questions: script.awaitingQuestions, toolCallId: "mock-ask-user" })
            )
          );
        }
      }
      controller.enqueue(
        encoder.encode(
          sse("done", {
            model: "mock",
            provider: "mock",
            usedRounds: 0,
            finishReason: script?.awaitingQuestions ? "awaiting_user" : "mock",
            ...(script ? { diagnose: { context: script.nextContext } } : {}),
          })
        )
      );
      controller.close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

export async function POST(request: Request) {
  // 匿名客户端标识（无登录体系的 user_id 替代，doc/user-settings.md §4）：
  // 仅日志追溯用，不参与路由/存储，服务端保持逐请求无状态
  const clientId = request.headers.get('x-client-id') ?? 'anonymous';
  console.log(`[chat] client=${clientId}`);

  // messages 元素可带 images（聊天界面上传的图片 dataUrl，组装成多模态内容）、
  // imageTexts（本地 OCR 转文字产物，非空时忽略 images 本体，任何模型可安全消费，
  // 见 doc/browser-local-ocr.md §6.2）与 files（聊天界面上传的纯文本文件，
  // 按 [文件 名字] 锚点拼进正文，纯文本模型同样可用）
  const body = (await request.json()) as ChatRequestBody;

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
       */
      const pump = async (messages: ProviderMessage[]): Promise<LoopRunResult> => {
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
          // 上游终端用户标识（随机 UUID；wip-safety-protocol §6）
          user: typeof body.user === 'string' && body.user.length <= 64 ? body.user : undefined,
        });

        for await (const ev of generator) {
          // 防御：上游若仍下发空事件（undefined），直接跳过，避免取属性抛错导致整条 SSE 中断
          if (!ev) continue;
          if (ev.type === 'content') {
            outputText += ev.delta;
            controller.enqueue(encoder.encode(sse('content', { delta: ev.delta })));
          } else if (ev.type === 'reasoning') {
            controller.enqueue(encoder.encode(sse('reasoning', { delta: ev.delta })));
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
          } else if (ev.type === 'error') {
            failed = true;
            controller.enqueue(
              encoder.encode(
                sse('error', {
                  // loop 已标注 code（parse_error/provider_error）则透传；未标注按模型请求失败兜底
                  code: ev.code ?? 'provider_error',
                  error: explainProviderError(ev.message),
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

        // 诊断后处理：提交补交 / guard 重试由 finalize 编排（重试段内容照常流式转发），
        // 随后统一发 diagnosis 与 done；awaiting_user / 失败轮不做后处理
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
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sse("error", {
              code: "provider_error",
              error: explainProviderError(
                err instanceof Error ? err.message : "模型请求失败"
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
