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
 *   event: error         data: {"error":"..."}
 *
 * 实现：委托给 lib/tools/loop.ts 的 runToolLoop 进行编排，
 * 使用适配器屏蔽 native 与 text 模式的差异。
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

  // 模型选择：请求指定模型优先；否则取第一个可用 provider 的首个模型
  let model = body.model?.trim();
  if (!model) {
    const list = await getModelList();
    model = list.models[0]?.name;
  }
  if (!model) {
    return new Response(
      sse('error', {
        error:
          '未配置任何模型 API Key：请复制 .env.example 为 .env.local，并填写 DEEPSEEK_API_KEY / ZHIPU_API_KEY / CUSTOM_API_KEY 三者之一后再试。',
      }),
      { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }
    );
  }

  const { provider } = resolveProvider(model);

  if (!provider.isAvailable()) {
    return new Response(
      sse('error', {
        error: `模型 ${model} 对应的 Provider（${provider.name}）未配置完整环境变量。请检查 .env.local 中对应的 API_KEY / BASE_URL / MODEL 配置。`,
        model,
        provider: provider.name,
      }),
      { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }
    );
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
            sse('error', {
              error: err instanceof Error ? err.message : '模型请求失败',
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
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
