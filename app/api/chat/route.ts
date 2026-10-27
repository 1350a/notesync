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

/** 将内部消息转换为 OpenAI 兼容 messages（图片/PDF 附件以文本标注随消息发送） */
function toOpenAIMessages(messages: ChatRequest["messages"]) {
  return messages.map((m) => {
    const attachmentNotes = (m.attachments ?? [])
      .map((att) => {
        if (att.type.startsWith("image/")) {
          return `[用户上传了图片附件：${att.name}]`;
        }
        return `[用户上传了PDF附件：${att.name}]`;
      })
      .join("\n");

    const content = [attachmentNotes, m.content].filter(Boolean).join("\n\n");
    return { role: m.role, content: content || "（空消息）" };
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
        ? "请求 ollama 超时，请确认服务已启动且模型推理未卡住。"
        : "无法连接本地 ollama 服务，请确认已安装并运行 ollama（默认端口 11434）。";
    return Response.json(
      { content: "", error: msg } satisfies ChatResponse,
      { status: 200 }
    );
  }
}
