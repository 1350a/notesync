/**
 * POST /api/chat
 * 工具调用版（SSE 流式）。
 *
 * 协议（SSE，text/event-stream）：
 *   event: reasoning     data: {"delta":"思考过程增量"}
 *   event: content       data: {"delta":"回复内容增量"}
 *   event: tool_call     data: {"id":"...","name":"...","arguments":{...}}
 *   event: tool_result   data: {"id":"...","ok":true,"summary":"...","ms":12}
 *   event: awaiting_user data: {"question":"...","toolCallId":"..."}
 *   event: done          data: {"model":"...","provider":"...","usedRounds":1,"finishReason":"stop"}
 *   event: error         data: {"code":"...","error":"..."}
 *
 * error.code 取值（前端据此区分提示口径）：
 *   no_model        未配置任何可用模型
 *   invalid_model   请求的模型名不属于任何已配置 Provider（不再静默回落）
 *   unconfigured    归属 Provider 的 API_KEY / BASE_URL 缺失
 *   provider_error  上游返回错误（含 401 鉴权失败、模型不存在等）
 *
 * 实现：按模型名归属路由到 Provider 后，委托 lib/tools/loop.ts 的 runToolLoop 编排，
 * 使用适配器屏蔽 native 与 text 模式的差异；任何异常均以 error 事件回传由前端展示。
 */
import { getModelList, resolveProvider } from '@/lib/provider';
import type { ProviderMessage } from '@/lib/provider/types';
import { createAdapter } from '@/lib/tools/adapters';
import { registerBuiltinTools } from '@/lib/tools/builtin';
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
  code: "invalid_model" | "unconfigured" | "provider_error" | "no_model";
  error: string;
  model?: string;
  provider?: string;
  available?: string[];
}): Response {
  return new Response(sse("error", data), { headers: SSE_HEADERS });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    model?: string;
    messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    content?: string;
  };

  // 组装发送给模型的消息：优先用显式 messages，否则用 content
  let providerMessages: ProviderMessage[];
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    providerMessages = body.messages.map((m) => ({
      role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
    }));
    if (body.content) {
      providerMessages.push({ role: 'user', content: body.content });
    }
  } else {
    providerMessages = [{ role: 'user', content: body.content || '' }];
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

  // 工具配置判断
  const toolsEnabled = process.env.TOOLS_ENABLED !== 'false';
  const tools = toolsEnabled ? getEnabledTools() : [];
  const maxRounds = parseInt(process.env.TOOL_MAX_ROUNDS || '3', 10);

  // 决定适配器模式（默认 native；custom 可以强制降级 text）
  let mode: ToolMode = 'native';
  if (provider.name === 'custom' && process.env.CUSTOM_TOOL_MODE === 'text') {
    mode = 'text';
  }
  const adapter = createAdapter(mode);

  // 清洗历史（如将上轮的 ask_user 调用痕迹转为普通文本）
  providerMessages = adapter.preprocessMessages(providerMessages);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const generator = runToolLoop({
          model: model!,
          provider,
          messages: providerMessages,
          adapter,
          tools,
          maxRounds,
          signal: request.signal,
        });

        for await (const ev of generator) {
          if (ev.type === 'content') {
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
            controller.enqueue(
              encoder.encode(
                sse('awaiting_user', { question: ev.question, toolCallId: ev.toolCallId })
              )
            );
          } else if (ev.type === 'done') {
            controller.enqueue(
              encoder.encode(
                sse('done', {
                  model,
                  provider: provider.name,
                  usedRounds: ev.usedRounds,
                  finishReason: ev.finishReason,
                })
              )
            );
          } else if (ev.type === 'error') {
            controller.enqueue(
              encoder.encode(sse('error', { error: ev.message, model, provider: provider.name }))
            );
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sse("error", {
              code: "provider_error",
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

  return new Response(stream, { headers: SSE_HEADERS });
}
