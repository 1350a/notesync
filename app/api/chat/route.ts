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
 *   no_content      上传的附件全部提取失败，没有可发送的内容
 *   provider_error  上游返回错误（含 401 鉴权失败、模型不存在等）
 *
 * 诊断模式附件：请求体可带 attachments（结构见 lib/diagnose/types.ts），
 * 服务端用 assembleDiagnoseMessage 组装成单条 user 消息追加在 messages 末尾；
 * 模型不接受图片时自动降级为文字占位，不做静默丢弃。
 * MOCK_MODEL=1 时不调用任何上游，只回显组装结构，用于零 token 验证发送数据。
 *
 * 实现：按模型名归属路由到 Provider 后，委托 lib/tools/loop.ts 的 runToolLoop 编排，
 * 使用适配器屏蔽 native 与 text 模式的差异；任何异常均以 error 事件回传由前端展示。
 */
import {
  buildProviderMessages,
  explainProviderError,
  MAX_FILE_MESSAGES,
  MAX_IMAGE_MESSAGES,
  type ChatRequestBody,
} from '@/lib/chat/messages';
import { assembleDiagnoseMessage } from '@/lib/diagnose/assemble';
import type { DiagnoseAttachment, ReviseCategory } from '@/lib/diagnose/types';
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
  code: "invalid_model" | "unconfigured" | "provider_error" | "no_model" | "no_content";
  error: string;
  model?: string;
  provider?: string;
  available?: string[];
}): Response {
  return new Response(sse("error", data), { headers: SSE_HEADERS });
}

const CATEGORIES = new Set<ReviseCategory>(["origin", "wrong", "correct", "analysis"]);

/** 单张图片 dataUrl 上限（约 9MB 原图），超出直接丢弃，防止请求体撑爆内存 */
const MAX_DATA_URL = 12 * 1024 * 1024;

/**
 * 校验前端上传的 attachments。
 * 非法项一律丢弃（附 console.warn 便于排查），不因一条脏数据让整批诊断失败。
 */
function parseAttachments(raw: unknown): DiagnoseAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: DiagnoseAttachment[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const category = record.category;
    if (!name || typeof category !== "string" || !CATEGORIES.has(category as ReviseCategory)) {
      console.warn("[diagnose] 丢弃非法附件：缺少文件名或分类不属于四类标签");
      continue;
    }

    const rawUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
    const dataUrl = rawUrl.startsWith("data:image/") ? rawUrl : undefined;
    if (rawUrl && !dataUrl) {
      console.warn(`[diagnose] ${name}：dataUrl 不是图片数据，已忽略`);
    }
    if (dataUrl && dataUrl.length > MAX_DATA_URL) {
      console.warn(`[diagnose] ${name}：图片超过 ${MAX_DATA_URL} 字符上限，已忽略`);
      continue;
    }

    const text = typeof record.text === "string" ? record.text : undefined;
    if (!dataUrl && !text?.trim()) {
      console.warn(`[diagnose] ${name}：既无图片也无文字内容，已忽略`);
      continue;
    }

    out.push({
      name,
      category: category as ReviseCategory,
      dataUrl,
      text,
      warning: typeof record.warning === "string" ? record.warning : undefined,
    });
  }

  return out;
}

/** 把组装结果渲染成可读摘要（MOCK 专用，不回显 base64 本体） */
function summarizeForMock(
  result: ReturnType<typeof assembleDiagnoseMessage>
): string {
  const content = result.message?.content;
  const parts = Array.isArray(content) ? content : [];
  const rows = parts.map((part, index) => {
    if (part.type === "text") {
      const preview = part.text.replace(/\s+/g, " ").slice(0, 48);
      return `| ${index + 1} | text | ${part.text.length} | ${preview} |`;
    }
    const url = part.image_url.url;
    const head = url.slice(0, 24);
    return `| ${index + 1} | image_url | ${url.length} | ${head}… |`;
  });

  const lines = [
    "> MOCK 模式：未调用任何模型，以下为实际组装出来的发送结构。",
    "",
    `- 消息条数：1（role=user）`,
    `- part 数：${parts.length}（图片 ${result.stats.images} / 文本 ${result.stats.texts}）`,
    `- 文本字符数：${result.stats.chars}`,
    "",
    "| # | 类型 | 长度 | 预览 |",
    "| --- | --- | --- | --- |",
    ...rows,
  ];

  if (result.warnings.length > 0) {
    lines.push("", "**降级与告警**", ...result.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}

/** MOCK 模式下的聊天消息摘要：只回显每条消息的内容形态，不回显 base64 本体 */
function summarizeChatMessages(messages: ProviderMessage[]): string {
  const rows = messages.map((m, index) => {
    if (typeof m.content === 'string') {
      const preview = m.content.replace(/\s+/g, ' ').slice(0, 48);
      return `| ${index + 1} | ${m.role} | text | ${m.content.length} | ${preview} |`;
    }
    const images = m.content.filter((part) => part.type === 'image_url').length;
    const texts = m.content.length - images;
    const preview = m.content
      .filter((part) => part.type === 'text')
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 32);
    return `| ${index + 1} | ${m.role} | 多模态（图片 ${images} / 文本 ${texts}） | - | ${preview} |`;
  });
  return [
    '> MOCK 模式：未调用任何模型，以下为 messages 实际组装结构。',
    '',
    '| # | 角色 | 内容形态 | 字符数 | 预览 |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** MOCK 响应流：不解析模型，直接回显组装摘要 */
function mockStream(attachments: DiagnoseAttachment[], body: ChatRequestBody): Response {
  const assembled = assembleDiagnoseMessage(attachments, {
    imageMode: process.env.MOCK_IMAGE_MODE === "text-only" ? "text-only" : "multimodal",
  });
  const { messages: chatMessages } = buildProviderMessages(body);
  const hasChatContent = chatMessages.some((m) =>
    typeof m.content === 'string' ? m.content.trim().length > 0 : m.content.length > 0
  );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 纯聊天请求（无诊断附件）：回显 messages 组装结构，便于零 token 校验图片是否真的进了请求
      if (attachments.length === 0) {
        if (!hasChatContent) {
          controller.enqueue(
            encoder.encode(sse('error', { code: 'no_content', error: '请求里没有可发送的内容。' }))
          );
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(sse('content', { delta: summarizeChatMessages(chatMessages) })));
        controller.enqueue(
          encoder.encode(
            sse('done', { model: 'mock', provider: 'mock', usedRounds: 0, finishReason: 'mock' })
          )
        );
        controller.close();
        return;
      }
      if (!assembled.message) {
        controller.enqueue(
          encoder.encode(
            sse("error", {
              code: "no_content",
              error: "上传的文件未提取到可用内容，请检查后重新上传。",
            })
          )
        );
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(sse("content", { delta: summarizeForMock(assembled) })));
      controller.enqueue(
        encoder.encode(
          sse("done", {
            model: "mock",
            provider: "mock",
            usedRounds: 0,
            finishReason: "mock",
          })
        )
      );
      controller.close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

export async function POST(request: Request) {
  // messages 元素可带 images（聊天界面上传的图片 dataUrl，组装成多模态内容）
  // 与 files（聊天界面上传的纯文本文件，按 [文件 名字] 锚点拼进正文，纯文本模型同样可用）
  const body = (await request.json()) as ChatRequestBody;

  // 本地链路验证开关：置 1 后不碰任何上游，只回显组装结构，便于零 token 校验发送数据
  if (process.env.MOCK_MODEL === '1') {
    return mockStream(parseAttachments(body.attachments), body);
  }

  // 组装发送给模型的消息：优先用显式 messages，否则用 content
  const { messages: builtMessages, droppedImageMessages, droppedFileMessages } =
    buildProviderMessages(body);
  if (droppedImageMessages > 0) {
    console.warn(
      `[chat] ${droppedImageMessages} 条较早消息的图片未随请求发送（超出 ${MAX_IMAGE_MESSAGES} 条上限，仅发送文字）`
    );
  }
  if (droppedFileMessages > 0) {
    console.warn(
      `[chat] ${droppedFileMessages} 条较早消息的文本文件未随请求发送（超出 ${MAX_FILE_MESSAGES} 条上限）`
    );
  }
  let providerMessages = builtMessages;

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

  // 诊断模式附件：组装成一条 user 消息追加在历史末尾；模型不吃图片时自动降级为文字占位
  const attachments = parseAttachments(body.attachments);
  if (attachments.length > 0) {
    const assembled = assembleDiagnoseMessage(attachments, {
      imageMode: provider.acceptsImages === false ? 'text-only' : 'multimodal',
    });
    if (!assembled.message) {
      return errorStream({
        code: 'no_content',
        error: '上传的文件未提取到可用内容，请检查后重新上传。',
        model,
        provider: provider.name,
      });
    }
    providerMessages.push(assembled.message);
    for (const warning of assembled.warnings) {
      console.warn('[diagnose]', warning);
    }
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
          // 防御：上游若仍下发空事件（undefined），直接跳过，避免取属性抛错导致整条 SSE 中断
          if (!ev) continue;
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
              encoder.encode(
                sse('error', {
                  code: 'provider_error',
                  error: explainProviderError(ev.message),
                  model,
                  provider: provider.name,
                })
              )
            );
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sse("error", {
              code: "provider_error",
              error: explainProviderError(
                err instanceof Error ? err.message : "模型请求失败"
              ),
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
