/**
 * 聊天消息 -> Provider 消息的组装逻辑（纯函数，无副作用，便于脚本单测）。
 *
 * 与诊断附件共用同一套图片过滤口径：非 data:image/ 开头或超出体积上限的项逐张丢弃，
 * 不因一条脏数据让整个请求失败。
 */
import type { ProviderMessage } from '../provider/types.ts';
import type { AskUserQuestion } from '../tools/types.ts';
import type { DiagnosisResult } from '../diagnose/types.ts';
import { formatOcrBlock } from '../ocr/image-handling.ts';

/** 单张图片 dataUrl 上限（约 9MB 原图），超出直接丢弃，防止请求体撑爆内存 */
export const MAX_DATA_URL = 12 * 1024 * 1024;

/** 一次请求中最多保留的带图消息条数：更早的图片只发文字，避免 base64 累积撑爆请求体 */
export const MAX_IMAGE_MESSAGES = 3;

/** 一次请求中最多保留的带文本文件消息条数：更早的文本文件不再重发，避免多轮线性膨胀 */
export const MAX_FILE_MESSAGES = 2;

/** 单个文本文件字符上限（约 20 万字符），超出即截断或丢弃 */
export const MAX_TEXT_FILE_CHARS = 200_000;

/** 同一条消息里所有文本文件合计字符上限 */
export const MAX_TEXT_TOTAL_CHARS = 400_000;

/** 随消息上传的纯文本文件（前端已读取为字符串，不含二进制） */
export interface ChatTextFile {
  name: string;
  text: string;
}

/** 前端展示用的一条工具调用（tool_call / tool_result SSE 事件的落地形态） */
export interface ToolCallView {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** tool_result 到达后回填；缺省表示仍在执行 */
  result?: { ok: boolean; summary: string; ms: number };
}

/** 前端聊天消息的统一形态（hooks/useChat 与 ChatList 共用，避免重复定义漂移） */
export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  /** 用户随消息上传的图片 dataUrl（OCR 模式下仅用于本地展示，不再上行） */
  images?: string[];
  /**
   * 已过期的图片槽位下标（doc/chat-history.md §4.1）：纯展示态，不落库、不参与
   * 上行组装。images[i] === '' 且 i 在此列表中时渲染「图片已过期」占位块；
   * 未登记的 '' 槽位直接跳过渲染（不给破图）
   */
  expiredImages?: number[];
  /**
   * 本地 OCR 转文字产物（与 images 一一对应）：上行时以 imageTexts 契约随消息发送，
   * 服务端拼成文本块；气泡上以"已本地OCR"标注透出（doc/browser-local-ocr.md §6.2）
   */
  ocrTexts?: string[];
  /**
   * OCR 产物的发送形态：local-only 全本地（images 仅本地展示不上行）；
   * mixed 混合档（OCR 文本 + 原图都上行，需多模态模型）。缺省沿用旧口径
   * （有 ocrTexts 即全本地），由发送时的三档选择写入
   */
  imageSendMode?: 'local-only' | 'mixed';
  /** 用户随消息上传的纯文本文件 */
  files?: ChatTextFile[];
  /** assistant 消息：本轮工具调用轨迹 */
  toolCalls?: ToolCallView[];
  /**
   * assistant 消息：ask_user 中断待回答的问题列表（含可选预设选项）。
   * 问题不再写入 content（content 保留模型前导文本）；问答上下文由下一轮
   * 用户回答消息文本自带（"1. 【label】question：answer"）。仅存内存，无持久化。
   */
  awaitingQuestions?: AskUserQuestion[];
  /** assistant 消息：诊断模式结构化结果（SSE diagnosis 事件落地，DiagnosisCard 渲染） */
  diagnosis?: DiagnosisResult;
  /**
   * 本机生成的提示气泡（词表硬拦截/关怀话术，未发生任何网络请求）：
   * 仅本地展示，不进入上行历史
   */
  localOnly?: boolean;
  /** assistant 消息：被上游拦截（content_blocked）——展示固定说明且不进入上行历史（§3.1 回滚） */
  blocked?: boolean;
}

/** 请求体里与消息相关的字段 */
export interface ChatRequestBody {
  model?: string;
  messages?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    images?: string[];
    /** 本地 OCR 转文字产物：与 images 对应的识别文本；非空时服务端忽略 images 本体（doc/browser-local-ocr.md §6.2） */
    imageTexts?: unknown;
    files?: unknown;
  }>;
  content?: string;
  attachments?: unknown;
  /** 诊断模式负载（context + event，结构见 lib/diagnose/types.ts DiagnoseRequestPayload；缺省即普通聊天） */
  diagnose?: unknown;
  /** 上游终端用户标识（纯随机 UUID，doc/user-settings.md §4.1；服务端经 runToolLoop 透传） */
  user?: unknown;
  /** 思考强度档位（doc/user-settings.md §2.1；服务端严格校验后经 CompleteOptions 透传） */
  thinkingEffort?: unknown;
  /** 本地检索命中片段（浏览器端 RAG 产物，doc/browser-local-inference.md §6.2） */
  ragContexts?: unknown;
}

/** 本地检索命中片段：客户端检索后随请求上行，服务端校验后注入正文 */
export interface RagContext {
  title: string;
  snippet: string;
  score: number;
}

/** 注入片段条数上限 */
export const MAX_RAG_CONTEXTS = 4;
/** 单条命中标题字符上限 */
export const RAG_TITLE_MAX_CHARS = 200;
/** 单条命中片段字符上限 */
export const RAG_SNIPPET_MAX_CHARS = 800;

/**
 * 上游对图片输入的拒绝五花八门（invalid image input / does not support vision …），
 * 统一转成可操作的中文提示，避免用户看到裸英文 400 不知所措。
 * 非图片相关错误原样返回。
 */
export function explainProviderError(message: string): string {
  // content.type：智谱对纯文本模型收图返回「messages.content.type 参数非法，取值范围 ['text']」
  const isImageIssue =
    /invalid image|image input|image_url|vision|multimodal|unsupported image|does not support image|content\.type/i.test(
      message
    );
  if (!isImageIssue) return message;
  return (
    `${message}\n\n` +
    '该模型不接受图片输入（多半是纯文本模型）。可选处理：① 切换到支持多模态的模型；' +
    '② 诊断模式下改用 PDF / 文本文件，或先对图片做文字提取再发送。'
  );
}

/**
 * 解析随消息上行的 OCR 文本（imageTexts）。
 * 只有"字符串数组且每项非空"才视为有效；脏数据一律按未提供处理，回落原图片语义。
 */
function parseImageTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const texts = raw.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  return texts.length === raw.length ? texts : [];
}

/** 把一条消息的 images 转成 OpenAI 兼容的多模态内容；无有效图片时退回纯文本 */
export function buildUserContent(
  text: string,
  images: unknown,
  imageTexts?: unknown
): ProviderMessage['content'] {
  const ocrTexts = parseImageTexts(imageTexts);
  const urls = Array.isArray(images)
    ? images.filter(
        (item): item is string =>
          typeof item === 'string' &&
          item.startsWith('data:image/') &&
          item.length <= MAX_DATA_URL
      )
    : [];
  // 混合档（doc/browser-local-ocr.md §6.2）：OCR 文本块打底 + 原图补充，
  // 仅在客户端同时上行两者时触发（全本地模式客户端不上行图片本体）
  if (ocrTexts.length > 0 && urls.length > 0) {
    return [
      {
        type: 'text' as const,
        text: [text.trim(), ...ocrTexts.map((t) => formatOcrBlock(t))].filter(Boolean).join('\n\n'),
      },
      ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ];
  }
  // 全本地 OCR 模式：图片本体不进请求，识别文本以固定格式块拼进正文，任何模型可安全消费
  if (ocrTexts.length > 0) {
    return [text.trim(), ...ocrTexts.map((t) => formatOcrBlock(t))]
      .filter(Boolean)
      .join('\n\n');
  }
  if (urls.length === 0) return text;
  return [
    ...(text.trim() ? [{ type: 'text' as const, text }] : []),
    ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
}

/**
 * 校验并规整随消息上传的文本文件：缺名、无内容、超单文件上限的直接丢弃；
 * 合计超过总量上限后停止收录，保证请求体不失控。
 */
export function parseTextFiles(raw: unknown): ChatTextFile[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTextFile[] = [];
  let total = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const text = typeof record.text === 'string' ? record.text : '';
    if (!name || !text.trim()) continue;
    if (text.length > MAX_TEXT_FILE_CHARS) continue;
    if (total + text.length > MAX_TEXT_TOTAL_CHARS) break;
    total += text.length;
    out.push({ name, text });
  }

  return out;
}

/** 把文本文件按 `[文件 名字]` 锚点拼在正文之后（纯文本模型同样可用，无需多模态） */
export function mergeTextFiles(text: string, files: ChatTextFile[]): string {
  if (files.length === 0) return text;
  const blocks = files.map((file) => `[文件 ${file.name}]\n${file.text}`);
  return [text.trim(), ...blocks].filter(Boolean).join('\n\n');
}

/**
 * 校验并规整本地检索命中片段（ragContexts）。从严口径（doc/browser-local-inference.md §6.2）：
 * 条数超限、任一条字段缺失/越界 → 整组丢弃，按未提供处理；绝不抛错、绝不静默改写。
 */
export function parseRagContexts(raw: unknown): RagContext[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RAG_CONTEXTS) return [];
  const out: RagContext[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const snippet = typeof record.snippet === 'string' ? record.snippet.trim() : '';
    const score = record.score;
    const scoreValid =
      typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1;
    if (
      !title ||
      !snippet ||
      title.length > RAG_TITLE_MAX_CHARS ||
      snippet.length > RAG_SNIPPET_MAX_CHARS ||
      !scoreValid
    ) {
      return [];
    }
    out.push({ title, snippet, score });
  }
  return out;
}

/** 把检索命中片段格式化为注入正文的【本地检索】块；空数组返回空串（不注入） */
export function formatRagBlock(contexts: RagContext[]): string {
  if (contexts.length === 0) return '';
  const lines = contexts.map((c, i) => `[${i + 1}] ${c.title}\n${c.snippet}`);
  return [
    '【本地检索】以下为浏览器本地知识库检索结果，供参考：',
    ...lines,
    '【/本地检索】',
  ].join('\n');
}

/** buildProviderMessages 的可选行为开关 */
export interface BuildMessagesOptions {
  /**
   * 是否保留消息中的图片（默认 true）。
   * 选中纯文本模型时传 false：带图消息降级为文字并留一行占位说明，
   * 避免原样直传 image_url 被上游 400（与诊断附件的 text-only 降级同一口径）。
   */
  allowImages?: boolean;
}

/**
 * 把请求体的 messages 组装成 Provider 消息序列。
 * 只有最近 MAX_IMAGE_MESSAGES 条带图消息保留图片，更早的仅发文字（多轮 base64 会线性膨胀）；
 * 文本文件同理，只保留最近 MAX_FILE_MESSAGES 条，更早的替换为一行省略提示。
 * options.allowImages 为 false 时（所选模型不支持图片），保留条目的图片同样降级为文字占位。
 * 返回值同时给出被丢弃图片 / 文件的消息条数，供调用方按需记录日志。
 */
export function buildProviderMessages(
  body: ChatRequestBody,
  options?: BuildMessagesOptions
): {
  messages: ProviderMessage[];
  droppedImageMessages: number;
  droppedFileMessages: number;
} {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return {
      messages: [{ role: 'user', content: body.content || '' }],
      droppedImageMessages: 0,
      droppedFileMessages: 0,
    };
  }

  const keepImages = new Set<number>();
  const keepFiles = new Set<number>();
  for (let i = body.messages.length - 1; i >= 0; i -= 1) {
    const msg = body.messages[i];
    if (msg.role !== 'user') continue;
    // 图片配额按「该消息是否带 images 本体」判定：混合档（imageTexts+images 同带）占用配额，
    // 全本地 OCR 消息（仅 imageTexts）不带本体、不占用（doc/browser-local-ocr.md §6.2）
    if (
      keepImages.size < MAX_IMAGE_MESSAGES &&
      Array.isArray(msg.images) &&
      msg.images.length > 0
    ) {
      keepImages.add(i);
    }
    if (keepFiles.size < MAX_FILE_MESSAGES && parseTextFiles(msg.files).length > 0) {
      keepFiles.add(i);
    }
    if (keepImages.size >= MAX_IMAGE_MESSAGES && keepFiles.size >= MAX_FILE_MESSAGES) break;
  }

  let droppedImageMessages = 0;
  let droppedFileMessages = 0;
  const allowImages = options?.allowImages !== false;
  // 本地检索命中片段只注入最后一条用户消息（doc/browser-local-inference.md §6.2）；
  // 解析失败整组丢弃，注入是纯增益，不影响消息发送
  const ragBlock = formatRagBlock(parseRagContexts(body.ragContexts));
  let lastUserIndex = -1;
  for (let i = body.messages.length - 1; i >= 0; i -= 1) {
    if (body.messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  const messages: ProviderMessage[] = body.messages.map((m, index) => {
    // 客户端不允许注入 system：system 提示词只能由服务端注入（CHAT_BASE_SYSTEM_PROMPT
    // 与诊断分阶段提示词）。原样透传等于把提示词控制权交给请求方，是提示词注入面；
    // 丢弃并留痕，不静默。
    if (m.role === 'system') {
      console.warn(`[chat] 第 ${index + 1} 条消息 role=system 被丢弃：system 仅由服务端注入`);
      return null;
    }
    const ocrTexts = m.role === 'user' ? parseImageTexts(m.imageTexts) : [];
    const isOcrTextMessage = ocrTexts.length > 0;
    const hasImages = Array.isArray(m.images) && m.images.length > 0;
    const files = m.role === 'user' ? parseTextFiles(m.files) : [];
    if (hasImages && !isOcrTextMessage && !keepImages.has(index)) droppedImageMessages += 1;
    if (files.length > 0 && !keepFiles.has(index)) droppedFileMessages += 1;

    let text = mergeTextFiles(m.content || '', keepFiles.has(index) ? files : []);
    if (index === lastUserIndex && ragBlock) {
      text = `${ragBlock}\n\n${text}`;
    }
    if (files.length > 0 && !keepFiles.has(index)) {
      text = [text, '[该条消息附带的文件内容已省略]'].filter(Boolean).join('\n\n');
    }

    let content: ProviderMessage['content'] = text;
    if (isOcrTextMessage || (hasImages && keepImages.has(index))) {
      if (allowImages && hasImages && keepImages.has(index)) {
        // 直传或混合档（imageTexts+images 同带时 buildUserContent 自动按混合组装）
        content = buildUserContent(text, m.images, ocrTexts);
      } else if (isOcrTextMessage) {
        // 全本地：识别文本拼块，图片本体不进请求；纯文本模型同样安全
        content = buildUserContent(text, undefined, ocrTexts);
      } else {
        // 能力降级不静默：留一行占位让模型知道该条消息带过图（与文件省略提示同款式）
        content = [text, '[该条消息附带的图片已省略]'].filter(Boolean).join('\n\n');
      }
    }

    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content,
    };
  }).filter((m): m is ProviderMessage => m !== null);

  if (body.content) {
    messages.push({ role: 'user', content: body.content });
  }

  return { messages, droppedImageMessages, droppedFileMessages };
}
