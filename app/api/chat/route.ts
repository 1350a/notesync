import type { ChatRequest } from "@/lib/types";
import { runHarnessStream, DEFAULT_OLLAMA_MODEL } from "@/lib/harness";
import { extractPdfText } from "@/lib/pdf";
import { extractImageText } from "@/lib/ocr";

/**
 * POST /api/chat
 * 薄路由：接收多轮消息历史，交给 LLM harness 编排，返回 SSE 事件流。
 *
 * 事件流格式（text/event-stream）：
 *   event: status  { message: "正在理解题目信息…" }
 *   event: token   { text: "诊断正文增量" }
 *   event: done    { phase, questions, content, model, provider, imageSummary?, thinking? }
 *   event: error   { error: "友好错误信息" }
 *
 * harness 内部完成：
 * - Agent 决策循环：工具检索（RAG 知识库）→ 追问 → 诊断
 * - 追问轮数状态机（防死循环）、图片跨轮记忆
 * - DeepSeek / ollama 双 provider 路由（含多模态图片上传能力）
 * - PDF 附件文本解析（这里完成，注入用户消息）
 */
export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest;
  const model = body.model || DEFAULT_OLLAMA_MODEL;
  const messages = body.messages ?? [];

  // 对历史最后一条用户消息做 PDF 解析 / 图片 OCR（若尚未注入过，识别文本并入 content）
  let history = messages;
  {
    const injectNotes: string[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.role !== "user") continue;
      const atts = m.attachments ?? [];
      const pdfAtts = atts.filter(
        (att) =>
          att.type === "application/pdf" || att.name.toLowerCase().endsWith(".pdf")
      );
      const imgAtts = atts.filter((att) => att.type.startsWith("image/"));
      const alreadyInjected =
        m.content.includes("[PDF内容：") || m.content.includes("[图片OCR识别内容：");
      if ((pdfAtts.length === 0 && imgAtts.length === 0) || alreadyInjected) break;
      for (const att of pdfAtts) {
        if (att.dataUrl) {
          const pdfText = await extractPdfText(att.dataUrl);
          injectNotes.push(`[PDF内容：${pdfText || "解析失败或为空"}]`);
        } else {
          injectNotes.push(`[PDF附件：${att.name}（无数据，无法解析）]`);
        }
      }
      for (const att of imgAtts) {
        if (att.dataUrl) {
          const ocrText = await extractImageText(att.dataUrl);
          if (ocrText) {
            injectNotes.push(`[图片OCR识别内容：${ocrText}]`);
          } else {
            injectNotes.push(`[图片OCR识别：未识别到文字或识别失败]`);
          }
        } else {
          injectNotes.push(`[图片附件：${att.name}（无数据，无法OCR）]`);
        }
      }
      if (injectNotes.length > 0) {
        history = [...history];
        history[i] = {
          ...m,
          content: [...injectNotes, m.content].filter(Boolean).join("\n\n"),
        };
      }
      break;
    }
  }

  // 若请求带新消息（纯文字或附件），拼到历史末尾（兼容调用方）
  if (body.content || (body.attachments && body.attachments.length > 0)) {
    const attachments = body.attachments ?? [];
    const notes: string[] = [];
    for (const att of attachments) {
      if (att.type.startsWith("image/")) {
        notes.push(`[用户上传了图片附件：${att.name}]`);
      } else if (
        att.type === "application/pdf" ||
        att.name.toLowerCase().endsWith(".pdf")
      ) {
        notes.push(`[用户上传了PDF附件：${att.name}]`);
        if (att.dataUrl) {
          const pdfText = await extractPdfText(att.dataUrl);
          if (pdfText) {
            notes.push(`[PDF内容：${pdfText}]`);
          } else {
            notes.push(`[PDF内容解析失败或为空]`);
          }
        }
      }
    }
    const pendingContent = [...notes, body.content].filter(Boolean).join("\n\n");
    history = [
      ...messages,
      {
        id: "pending",
        role: "user" as const,
        content: pendingContent,
        attachments,
        createdAt: Date.now(),
      },
    ];
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };
      // 单次请求最长 120 秒
      const timer = setTimeout(() => controller.error(new Error("请求超时")), 120000);
      try {
        for await (const ev of runHarnessStream({ model, messages: history })) {
          switch (ev.type) {
            case "status":
              send("status", { message: ev.message });
              break;
            case "token":
              send("token", { text: ev.text });
              break;
            case "done":
              send("done", ev.result);
              break;
            case "error":
              send("error", { error: ev.message });
              break;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "处理请求失败";
        send("error", { error: message });
      } finally {
        clearTimeout(timer);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
