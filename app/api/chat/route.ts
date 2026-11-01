/**
 * POST /api/chat
 * 简易重构版：薄路由，仅保证“用户发消息 → 按环境变量三选一选择模型 → 调用返回文本 → 前端展示”。
 *
 * 协议（JSON，非流式）：
 *   成功: { content, model, provider }
 *   失败: { error, model?, provider? }
 *   —— 即使模型侧返回 HTTP 401 等错误，也原样回传由前端展示，视为“链路已通（连通性优先）”。
 *
 * 与 .env.example / AGENTS.md 一致：三选一（DEEPSEEK / ZHIPU / CUSTOM，OpenAI 兼容），
 * 不再检测本地 ollama、不自动回退；key 缺失时返回明确的错误提示。
 *
 * 历史实现（harness 编排 / PDF 解析 / 图片 OCR / SSE 事件流）已注释保留在文件底部。
 */
import { resolveProvider, getModelList } from "@/lib/provider";
import type { ProviderMessage } from "@/lib/provider/types";

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
    return Response.json({
      error:
        "未配置任何模型 API Key：请复制 .env.example 为 .env.local，并填写 DEEPSEEK_API_KEY / ZHIPU_API_KEY / CUSTOM_API_KEY 三者之一后再试。",
    });
  }

  const { provider } = resolveProvider(model);

  // key/base_url 缺失 → 明确错误（不再回退 ollama）
  if (!provider.isAvailable()) {
    return Response.json({
      error: `模型 ${model} 对应的 Provider（${provider.name}）未配置完整环境变量。请检查 .env.local 中对应的 API_KEY / BASE_URL / MODEL 配置。`,
      model,
      provider: provider.name,
    });
  }

  try {
    const content = await provider.complete({ model, messages: providerMessages });
    return Response.json({ content, model, provider: provider.name });
  } catch (err) {
    // 401 等 HTTP 错误也原样回传，前端展示错误信息（连通性优先）
    return Response.json({
      error: err instanceof Error ? err.message : "模型请求失败",
      model,
      provider: provider.name,
    });
  }
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
