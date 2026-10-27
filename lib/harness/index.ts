/**
 * LLM Harness - 智能多轮对话编排层
 *
 * 核心职责：
 * 1. 判断信息充分性：模型先决定进入「追问阶段」还是「最终回答阶段」
 * 2. 结构化输出：解析模型返回的 JSON，区分 questions（待回答）与 content（诊断正文）
 * 3. Provider 路由：DeepSeek 可用时走云端（保留多模态图片上传），否则回退本地 ollama
 *
 * 调用方（app/api/chat/route.ts）只需把用户消息历史传入 runHarness，
 * 即可获得带 phase 标记的响应，前端据此展示追问列表并引导用户继续回答。
 */
import type { Message } from "@/lib/types";
import type { HarnessPhase, ProviderMessage } from "./types";
import { resolveProvider, DEFAULT_OLLAMA_MODEL } from "@/lib/provider";
import type { ProviderName } from "@/lib/provider/types";
import { SYSTEM_PROMPT } from "./prompts";

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
}

/**
 * 将内部消息转换为 Provider 消息。
 * DeepSeek 下仅最后一条（本轮新消息）携带真实图片数据（多模态 content 数组）；
 * 历史消息只保留文本标注，避免每轮重复上传大图、突破请求体上限。
 * ollama（qwen2.5 纯文本）继续使用文本标注。
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
            return `[用户上传了图片附件：${att.name}（图片过大，未随请求上传）]`;
          }
          return `[用户上传了图片附件：${att.name}]`;
        }
        return `[用户上传了PDF附件：${att.name}]`;
      })
      .join("\n");

    const text =
      [attachmentNotes, m.content].filter(Boolean).join("\n\n") || "（空消息）";

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

/** 从模型原始输出中提取并规范化 JSON 对象（容忍前后缀与代码块围栏） */
function extractJsonObject(raw: string): unknown {
  const text = raw.trim();
  // 去掉可能的 Markdown 代码块围栏
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  // 整段解析优先
  try {
    return JSON.parse(fenced);
  } catch {
    // 大括号栈匹配提取第一个完整对象
    let depth = 0;
    let start = -1;
    for (let i = 0; i < fenced.length; i++) {
      const ch = fenced[i];
      if (ch === "{") {
        if (start < 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            return JSON.parse(fenced.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

/** 规范化结构化输出：非法 phase 一律按 answer 处理，questions 清洗为字符串数组 */
function normalizeStructured(raw: string): {
  phase: HarnessPhase;
  questions: string[];
  content: string;
} {
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj !== "object") {
    return { phase: "answer", questions: [], content: raw };
  }
  const o = obj as Record<string, unknown>;
  const phase: HarnessPhase = o.phase === "question" ? "question" : "answer";
  const questions = Array.isArray(o.questions)
    ? o.questions
        .filter((q): q is string => typeof q === "string" && Boolean(q.trim()))
        .map((q) => q.trim())
    : [];
  const content =
    typeof o.content === "string" ? o.content.trim() : "";

  // question 阶段必须有实际问题，否则降级为 answer
  if (phase === "question" && questions.length === 0) {
    return { phase: "answer", questions: [], content: content || raw };
  }
  if (phase === "answer") {
    return { phase: "answer", questions: [], content: content || raw };
  }
  return { phase, questions, content };
}

/**
 * 运行一次 harness 诊断：
 * 组装 system + 多轮历史 -> 路由 provider -> 请求结构化输出 -> 解析 phase/questions/content。
 */
export async function runHarness(options: {
  model: string;
  messages: Message[];
  signal?: AbortSignal;
}): Promise<HarnessResult> {
  const { provider, model } = resolveProvider(options.model);
  const providerMessages: ProviderMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...toProviderMessages(options.messages, provider.name),
  ];

  try {
    const raw = await provider.complete({
      model,
      messages: providerMessages,
      json: true,
      signal: options.signal,
    });
    const parsed = normalizeStructured(raw);
    return {
      ...parsed,
      model,
      provider: provider.name,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HarnessError("请求超时", provider.name);
    }
    throw new HarnessError(
      err instanceof Error ? err.message : "模型请求失败",
      provider.name
    );
  }
}

/** 导出默认回退模型，供路由层展示 */
export { DEFAULT_OLLAMA_MODEL };
