import type { ChatRequest, ChatResponse } from "@/lib/types";

/** ollama OpenAI 兼容端点 */
const OLLAMA_OPENAI_BASE =
  process.env.OLLAMA_BASE_URL || "http://localhost:11434";

/** DeepSeek API Key（.env.local 中配置） */
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
/** DeepSeek OpenAI 兼容端点 */
const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
/** DeepSeek 官方模型列表 */
const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"];

/** 配置了 DeepSeek key 时使用云端，否则走本地 ollama */
const USE_DEEPSEEK = Boolean(DEEPSEEK_API_KEY);
/** 当前 provider 的默认模型 */
const DEFAULT_MODEL = USE_DEEPSEEK ? "deepseek-flash" : "qwen2.5:7b";

/** 将 ollama 模型名映射为 DeepSeek 模型（前端旧默认值兜底） */
function normalizeModel(model: string): string {
  if (!USE_DEEPSEEK) return model;
  if (!model || model === "qwen2.5:7b" || !DEEPSEEK_MODELS.includes(model)) {
    return DEFAULT_MODEL;
  }
  return model;
}

/** 单张图片 dataUrl 上限（base64 字符串长度，约 9MB 原图），防请求体超 DeepSeek 48MiB 限制 */
const MAX_IMAGE_DATA_URL = 12 * 1024 * 1024;

/** 将内部消息转换为 OpenAI 兼容 messages。
 * DeepSeek 下仅最后一条（本轮新消息）携带真实图片数据（多模态 content 数组）；
 * 历史消息只保留文本标注，避免每轮重复上传大图、突破请求体上限。
 * ollama（qwen2.5 纯文本）继续使用文本标注。 */
function toOpenAIMessages(messages: ChatRequest["messages"]) {
  return messages.map((m, idx) => {
    const isLast = idx === messages.length - 1;
    const images =
      USE_DEEPSEEK && isLast
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
            type: "image_url",
            image_url: { url: att.dataUrl as string },
          })),
        ],
      };
    }
    return { role: m.role, content: text };
  });
}

/**
 * POST /api/chat
 * 将多轮消息历史转发给模型服务（OpenAI 兼容端点），非流式完整响应。
 * 配置了 DEEPSEEK_API_KEY 时走 DeepSeek 云端；否则回退本地 ollama。
 * 请求体：{ model, messages, content?, attachments? }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const model = normalizeModel(body.model || DEFAULT_MODEL);
    const messages = body.messages ?? [];

    // 若请求带新消息（纯文字或附件），拼到历史末尾
    let history = messages;
    if (body.content || (body.attachments && body.attachments.length > 0)) {
      const attachmentNotes = (body.attachments ?? [])
        .map((att) =>
          att.type.startsWith("image/")
            ? `[用户上传了图片附件：${att.name}]`
            : `[用户上传了PDF附件：${att.name}]`
        )
        .join("\n");
      history = [
        ...messages,
        {
          id: "pending",
          role: "user" as const,
          content: [attachmentNotes, body.content].filter(Boolean).join("\n\n"),
          attachments: body.attachments ?? [],
          createdAt: Date.now(),
        },
      ];
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);

    const endpoint = USE_DEEPSEEK
      ? `${DEEPSEEK_BASE}/chat/completions`
      : `${OLLAMA_OPENAI_BASE}/v1/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (USE_DEEPSEEK) {
      headers.Authorization = `Bearer ${DEEPSEEK_API_KEY}`;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: toOpenAIMessages(history),
        stream: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const hint = USE_DEEPSEEK
        ? `DeepSeek 返回错误（HTTP ${res.status}），请检查 API Key 是否正确、余额是否充足。`
        : `ollama 返回错误（HTTP ${res.status}），请确认所选模型已下载：ollama pull ${model}`;
      return Response.json(
        {
          content: "",
          error: errText || hint,
        } satisfies ChatResponse,
        { status: 200 }
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };
    const content =
      data.choices?.[0]?.message?.content?.trim() ||
      "（模型未返回内容，请重试或更换模型）";

    return Response.json({
      content,
      model: data.model || model,
    } satisfies ChatResponse);
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? USE_DEEPSEEK
          ? "请求 DeepSeek 超时，请稍后重试。"
          : "请求 ollama 超时，请确认服务已启动且模型推理未卡住。"
        : USE_DEEPSEEK
          ? "无法连接 DeepSeek 服务，请检查网络后重试。"
          : "无法连接本地 ollama 服务，请确认已安装并运行 ollama（默认端口 11434）。";
    return Response.json(
      { content: "", error: msg } satisfies ChatResponse,
      { status: 200 }
    );
  }
}
