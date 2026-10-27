/**
 * LLM Harness - 智能诊断编排层（Agent 工作流）
 *
 * 核心职责：
 * 1. Agent 决策循环：模型每轮输出决策 JSON（tools/question/answer），
 *    服务端执行工具（RAG 检索）并把结果回填上下文，直至模型做出诊断或追问决策。
 * 2. 信息收集状态机：服务端统计已追问轮数，达到上限强制进入诊断（杜绝死循环）。
 * 3. 图片跨轮记忆：首轮模型生成 image_summary，后续轮次引用摘要而非重传图片。
 * 4. 流式输出：诊断正文通过 SSE 逐段下发（route 层转发），前端打字机渲染。
 *
 * 调用方（app/api/chat/route.ts）遍历 runHarnessStream 的事件流即可。
 */
import type { Message } from "@/lib/types";
import type { HarnessPhase, ProviderMessage } from "./types";
import { resolveProvider, DEFAULT_OLLAMA_MODEL } from "@/lib/provider";
import type { ProviderName } from "@/lib/provider/types";
import { buildSystemPrompt, ANSWER_GENERATION_PROMPT } from "./prompts";
import { buildStateBlock, MAX_ASKS, deriveAskCount } from "./state";
import { runAgentLoop } from "@/lib/agent/loop";
import { toolDescriptions } from "@/lib/agent/tools";
import type { ThinkingStep } from "@/lib/agent/types";

/** 单张图片 dataUrl 上限（base64 字符串长度，约 9MB 原图），防请求体超 DeepSeek 48MiB 限制 */
const MAX_IMAGE_DATA_URL = 12 * 1024 * 1024;

/** harness 抛出的业务错误，附带实际使用的 provider，便于路由层给出友好提示 */
export class HarnessError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderName
  ) {
    super(message);
    this.name = "HarnessError";
  }
}

/** harness 最终返回结果 */
export interface HarnessResult {
  phase: HarnessPhase;
  /** 追问阶段待回答的问题列表（answer 阶段为空数组） */
  questions: string[];
  /** 诊断正文（question 阶段通常为空字符串） */
  content: string;
  /** 实际使用的模型名 */
  model: string;
  /** 实际使用的 provider */
  provider: ProviderName;
  /** 图片内容一句话摘要（用于跨轮记忆） */
  imageSummary?: string;
  /** Agent 思考过程（工具调用/知识库检索记录） */
  thinking?: ThinkingStep[];
}

/** 流式事件（route 层序列化为 SSE） */
export type HarnessStreamEvent =
  | { type: "status"; message: string }
  | { type: "token"; text: string }
  | { type: "done"; result: HarnessResult }
  | { type: "error"; message: string };

/** 判断最后一条用户消息是否含图片 */
function hasImageInLastMessage(messages: Message[]): boolean {
  const last = messages[messages.length - 1];
  return Boolean(
    last &&
      Array.isArray(last.attachments) &&
      last.attachments.some((att) => att.type.startsWith("image/"))
  );
}

/**
 * 将内部消息转换为 Provider 消息。
 * DeepSeek 下仅最后一条（本轮新消息）携带真实图片数据（多模态 content 数组）；
 * 历史图片优先引用 imageSummary（跨轮记忆），无摘要则只保留文本标注，
 * 避免每轮重复上传大图、突破请求体上限。
 * PDF 内容文本由路由层解析后注入 content，这里只保留文件名标注。
 */
function toProviderMessages(
  messages: Message[],
  providerName: ProviderName
): ProviderMessage[] {
  return messages.map((m, idx) => {
    const isLast = idx === messages.length - 1;
    const images =
      providerName === "deepseek" && isLast
        ? (m.attachments ?? []).filter(
            (att) =>
              att.type.startsWith("image/") &&
              att.dataUrl &&
              att.dataUrl.length <= MAX_IMAGE_DATA_URL
          )
        : [];

    const attachmentNotes = (m.attachments ?? [])
      .map((att) => {
        if (att.type.startsWith("image/")) {
          if (att.dataUrl && att.dataUrl.length > MAX_IMAGE_DATA_URL) {
            return `[用户上传了图片附件：${att.name}（图片过大，未随请求上传，请结合对话理解）]`;
          }
          return `[用户上传了图片附件：${att.name}]`;
        }
        return `[用户上传了PDF附件：${att.name}]`;
      })
      .join("\n");

    // 历史图片：优先使用模型生成的摘要
    const imageSummaryNote =
      m.role === "user" && m.imageSummary
        ? `[该图片内容摘要（上一轮模型识别）：${m.imageSummary}]`
        : "";

    const text = [
      attachmentNotes,
      imageSummaryNote,
      m.content,
    ]
      .filter(Boolean)
      .join("\n\n") || "（空消息）";

    if (images.length > 0) {
      return {
        role: m.role,
        content: [
          { type: "text", text },
          ...images.map((att) => ({
            type: "image_url" as const,
            image_url: { url: att.dataUrl as string },
          })),
        ],
      };
    }
    return { role: m.role, content: text };
  });
}

/** 错误归一化：转换为 HarnessError（含 provider 信息） */
function toHarnessError(err: unknown, providerName: ProviderName): HarnessError {
  if (err instanceof HarnessError) return err;
  if (err instanceof Error && err.name === "AbortError") {
    return new HarnessError("请求超时，请稍后重试", providerName);
  }
  return new HarnessError(
    err instanceof Error ? err.message : "模型请求失败",
    providerName
  );
}

/**
 * 运行一次 Agent 工作流诊断，产出 SSE 事件流。
 *
 * 事件序列：
 * status（开始）→ [工具调用内部循环] → status（生成正文）→ token×N → done
 * 出错时产出 error 事件。
 */
export async function* runHarnessStream(options: {
  model: string;
  messages: Message[];
  signal?: AbortSignal;
}): AsyncGenerator<HarnessStreamEvent> {
  const { provider, model } = resolveProvider(options.model);
  const { messages, signal } = options;

  try {
    // ---- 状态机 ----
    const askCount = deriveAskCount(messages);
    const stateBlock = buildStateBlock(messages);
    const systemPrompt = buildSystemPrompt({
      stateBlock,
      toolDescriptions: toolDescriptions(),
      hasImage: hasImageInLastMessage(messages),
      askCount,
    });

    const providerMessages: ProviderMessage[] = [
      { role: "system", content: systemPrompt },
      ...toProviderMessages(messages, provider.name),
    ];

    yield { type: "status", message: "正在理解题目信息…" };

    // ---- Agent 决策循环（含工具调用）----
    const loop = await runAgentLoop({ model, provider, messages: providerMessages, signal });
    const decision = loop.decision;
    const thinking: ThinkingStep[] = [
      ...loop.thinking,
      { type: "status", message: "信息分析完成，正在确定诊断策略" },
    ];

    // ---- 追问分支（受上限硬约束）----
    if (
      decision.action === "question" &&
      decision.questions &&
      decision.questions.length > 0 &&
      askCount < MAX_ASKS
    ) {
      yield {
        type: "done",
        result: {
          phase: "question",
          questions: decision.questions,
          content: "",
          model,
          provider: provider.name,
          imageSummary: decision.image_summary,
          thinking,
        },
      };
      return;
    }

    // ---- 诊断分支（流式生成正文）----
    yield { type: "status", message: "正在生成诊断正文…" };

    const genMessages: ProviderMessage[] = [
      ...loop.finalMessages,
      { role: "user", content: ANSWER_GENERATION_PROMPT },
    ];

    let content = "";
    const streamComplete = provider.streamComplete;
    if (streamComplete) {
      for await (const delta of streamComplete({ model, messages: genMessages, signal })) {
        content += delta;
        yield { type: "token", text: delta };
      }
    } else {
      const raw = await provider.complete({ model, messages: genMessages, signal });
      content = raw;
      yield { type: "token", text: raw };
    }

    yield {
      type: "done",
      result: {
        phase: "answer",
        questions: [],
        content: content.trim(),
        model,
        provider: provider.name,
        imageSummary: decision.image_summary,
        thinking,
      },
    };
  } catch (err) {
    const hErr = toHarnessError(err, provider.name);
    yield { type: "error", message: hErr.message };
  }
}

/**
 * 非流式便捷封装：收集事件流为最终结果。
 * 供路由层/其他调用方在不需要打字机效果时使用。
 */
export async function runHarness(options: {
  model: string;
  messages: Message[];
  signal?: AbortSignal;
}): Promise<HarnessResult> {
  let result: HarnessResult | null = null;
  let lastError: string | null = null;
  for await (const ev of runHarnessStream(options)) {
    if (ev.type === "done") result = ev.result;
    if (ev.type === "error") lastError = ev.message;
  }
  if (result) return result;
  throw new HarnessError(lastError ?? "模型请求失败", "ollama");
}

/** 导出默认回退模型，供路由层展示 */
export { DEFAULT_OLLAMA_MODEL };
