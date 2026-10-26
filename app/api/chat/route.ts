import type { ChatRequest, ChatResponse } from "@/lib/types";

/** ollama OpenAI 兼容端点 */
const OLLAMA_OPENAI_BASE =
  process.env.OLLAMA_BASE_URL || "http://localhost:11434";

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
 * 将多轮消息历史转发给本地 ollama（OpenAI 兼容端点），非流式完整响应。
 * 请求体：{ model, messages, content?, attachments? }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const model = body.model || "qwen2.5:7b";
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

    const res = await fetch(`${OLLAMA_OPENAI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      return Response.json(
        {
          content: "",
          error:
            errText ||
            `ollama 返回错误（HTTP ${res.status}），请确认所选模型已下载：ollama pull ${model}`,
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
