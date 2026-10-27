import type { ChatRequest, ChatResponse } from "@/lib/types";
import { runHarness, HarnessError, DEFAULT_OLLAMA_MODEL } from "@/lib/harness";

/**
 * POST /api/chat
 * 薄路由：接收多轮消息历史，交给 LLM harness 编排。
 * harness 内部完成：
 * - 信息充分性判断（模型自主决定追问还是直接诊断）
 * - DeepSeek / ollama 双 provider 路由（含多模态图片上传能力）
 * - 结构化输出解析（phase: question/answer + questions/content）
 *
 * 请求体：{ model, messages, content?, attachments? }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const model = body.model || DEFAULT_OLLAMA_MODEL;
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

    try {
      const result = await runHarness({
        model,
        messages: history,
        signal: controller.signal,
      });

      return Response.json({
        content: result.content,
        phase: result.phase,
        questions: result.questions,
        model: result.model,
        provider: result.provider,
      } satisfies ChatResponse);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof HarnessError) {
      const hint =
        err.provider === "deepseek"
          ? "DeepSeek 服务异常，请检查 API Key、网络与余额。"
          : "本地 ollama 服务异常，请确认已运行 ollama 且模型已下载。";
      return Response.json(
        { content: "", error: `${hint}（${err.message}）` } satisfies ChatResponse,
        { status: 200 }
      );
    }
    return Response.json(
      { content: "", error: "处理请求失败，请稍后重试。" } satisfies ChatResponse,
      { status: 200 }
    );
  }
}
