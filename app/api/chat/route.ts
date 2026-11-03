/**
 * POST /api/chat
 * 简易重构版（SSE 流式）：用户发消息 → 按环境变量三选一选择模型 → 流式返回模型回复。
 *
 * 协议（SSE，text/event-stream）：
 *   event: reasoning  data: {"delta":"思考过程增量"}
 *   event: content    data: {"delta":"回复内容增量"}
 *   event: done        data: {"model":"...","provider":"..."}
 *   event: error       data: {"error":"...","model":"...","provider":"..."}
 * —— 即使模型侧返回 HTTP 401 等错误，也以 error 事件原样回传由前端展示（连通性优先）。
 *
 * 实现：优先复用 lib/provider/openaiCompat.ts 的 streamDetailed（含 reasoning 增量）；
 * provider 未实现 detailed 时依次降级 streamComplete / completeDetailed / complete。
 * 与 .env.example / AGENTS.md 一致：三选一（DEEPSEEK / ZHIPU / CUSTOM，OpenAI 兼容），
 * 不再检测本地 ollama、不自动回退；key 缺失时返回明确的 error 事件。
 *
 * 历史实现（harness 编排 / PDF 解析 / 图片 OCR / 旧 SSE 事件流）已注释保留在文件底部。
 */
import { resolveProvider, getModelList } from "@/lib/provider";
import type { ProviderMessage } from "@/lib/provider/types";

const encoder = new TextEncoder();

/** 封装一条 SSE 事件为字节流 */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    model?: string;
    messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    content?: string;
  };

  // 组装发送给模型的消息：优先用显式 messages，否则用 content
  let providerMessages: ProviderMessage[];
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    providerMessages = body.messages.map((m) => ({
      role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user",
      content: m.content || "",
    }));
    if (body.content) {
      providerMessages.push({ role: "user", content: body.content });
    }
  } else {
    providerMessages = [{ role: "user", content: body.content || "" }];
  }

  // 模型选择：请求指定模型优先；否则取第一个可用 provider 的首个模型
  let model = body.model?.trim();
  if (!model) {
    const list = await getModelList();
    model = list.models[0]?.name;
  }
  if (!model) {
    return new Response(
      sse("error", {
        error:
          "未配置任何模型 API Key：请复制 .env.example 为 .env.local，并填写 DEEPSEEK_API_KEY / ZHIPU_API_KEY / CUSTOM_API_KEY 三者之一后再试。",
      }),
      { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }
    );
  }

  const { provider } = resolveProvider(model);

  // key/base_url 缺失 → 明确错误（不再回退 ollama）
  if (!provider.isAvailable()) {
    return new Response(
      sse("error", {
        error: `模型 ${model} 对应的 Provider（${provider.name}）未配置完整环境变量。请检查 .env.local 中对应的 API_KEY / BASE_URL / MODEL 配置。`,
        model,
        provider: provider.name,
      }),
      { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }
    );
  }

  const options = { model, messages: providerMessages };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (provider.streamDetailed) {
          for await (const delta of provider.streamDetailed(options)) {
            if (delta.reasoning) {
              controller.enqueue(encoder.encode(sse("reasoning", { delta: delta.reasoning })));
            }
            if (delta.content) {
              controller.enqueue(encoder.encode(sse("content", { delta: delta.content })));
            }
          }
        } else if (provider.streamComplete) {
          for await (const part of provider.streamComplete(options)) {
            if (part) controller.enqueue(encoder.encode(sse("content", { delta: part })));
          }
        } else if (provider.completeDetailed) {
          const r = await provider.completeDetailed(options);
          if (r.reasoning) controller.enqueue(encoder.encode(sse("reasoning", { delta: r.reasoning })));
          if (r.content) controller.enqueue(encoder.encode(sse("content", { delta: r.content })));
        } else {
          const content = await provider.complete(options);
          if (content) controller.enqueue(encoder.encode(sse("content", { delta: content })));
        }
        controller.enqueue(encoder.encode(sse("done", { model, provider: provider.name })));
      } catch (err) {
        // 401 等 HTTP 错误也以 error 事件原样回传，前端展示错误信息（连通性优先）
        controller.enqueue(
          encoder.encode(
            sse("error", {
              error: err instanceof Error ? err.message : "模型请求失败",
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/* =====================================================================
 * 【历史遗留代码 - 已注释停用，保留原文便于恢复】
 * 原实现（简易重构前 app/api/chat/route.ts）：
 * - import type { ChatRequest } from "@/lib/types";
 * - import { runHarnessStream, DEFAULT_OLLAMA_MODEL } from "@/lib/harness";
 * - import { extractPdfText } from "@/lib/pdf";
 * - import { extractImageText } from "@/lib/ocr";
 * - POST 内：对历史最后一条用户消息做 PDF 解析 / 图片 OCR 注入、
 *   新消息附件处理、通过 runHarnessStream 产出 SSE 事件流
 *   （status / token / done / error），含 120s 超时。
 * 简易重构后不再接入 harness / agent / rag / ocr / pdf 编排。
 * 如需恢复，请还原本文件为旧版并配合 lib/harness 等目录使用。
 * ===================================================================== */
