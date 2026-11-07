/**
 * 聊天消息 -> Provider 消息的组装逻辑（纯函数，无副作用，便于脚本单测）。
 *
 * 与诊断附件共用同一套图片过滤口径：非 data:image/ 开头或超出体积上限的项逐张丢弃，
 * 不因一条脏数据让整个请求失败。
 */
import type { ProviderMessage } from '../provider/types';

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

/** 请求体里与消息相关的字段 */
export interface ChatRequestBody {
  model?: string;
  messages?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    images?: string[];
    files?: unknown;
  }>;
  content?: string;
  attachments?: unknown;
}

/**
 * 上游对图片输入的拒绝五花八门（invalid image input / does not support vision …），
 * 统一转成可操作的中文提示，避免用户看到裸英文 400 不知所措。
 * 非图片相关错误原样返回。
 */
export function explainProviderError(message: string): string {
  const isImageIssue =
    /invalid image|image input|image_url|vision|multimodal|unsupported image|does not support image/i.test(
      message
    );
  if (!isImageIssue) return message;
  return (
    `${message}\n\n` +
    '该模型不接受图片输入（多半是纯文本模型）。可选处理：① 切换到支持多模态的模型；' +
    '② 诊断模式下改用 PDF / 文本文件，或先对图片做文字提取再发送。'
  );
}

/** 把一条消息的 images 转成 OpenAI 兼容的多模态内容；无有效图片时退回纯文本 */
export function buildUserContent(text: string, images: unknown): ProviderMessage['content'] {
  const urls = Array.isArray(images)
    ? images.filter(
        (item): item is string =>
          typeof item === 'string' &&
          item.startsWith('data:image/') &&
          item.length <= MAX_DATA_URL
      )
    : [];
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
 * 把请求体的 messages 组装成 Provider 消息序列。
 * 只有最近 MAX_IMAGE_MESSAGES 条带图消息保留图片，更早的仅发文字（多轮 base64 会线性膨胀）；
 * 文本文件同理，只保留最近 MAX_FILE_MESSAGES 条，更早的替换为一行省略提示。
 * 返回值同时给出被丢弃图片 / 文件的消息条数，供调用方按需记录日志。
 */
export function buildProviderMessages(body: ChatRequestBody): {
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
    if (keepImages.size < MAX_IMAGE_MESSAGES && Array.isArray(msg.images) && msg.images.length > 0) {
      keepImages.add(i);
    }
    if (keepFiles.size < MAX_FILE_MESSAGES && parseTextFiles(msg.files).length > 0) {
      keepFiles.add(i);
    }
    if (keepImages.size >= MAX_IMAGE_MESSAGES && keepFiles.size >= MAX_FILE_MESSAGES) break;
  }

  let droppedImageMessages = 0;
  let droppedFileMessages = 0;
  const messages: ProviderMessage[] = body.messages.map((m, index) => {
    const hasImages = Array.isArray(m.images) && m.images.length > 0;
    const files = m.role === 'user' ? parseTextFiles(m.files) : [];
    if (hasImages && !keepImages.has(index)) droppedImageMessages += 1;
    if (files.length > 0 && !keepFiles.has(index)) droppedFileMessages += 1;

    let text = mergeTextFiles(m.content || '', keepFiles.has(index) ? files : []);
    if (files.length > 0 && !keepFiles.has(index)) {
      text = [text, '[该条消息附带的文件内容已省略]'].filter(Boolean).join('\n\n');
    }

    return {
      role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
      content: hasImages && keepImages.has(index) ? buildUserContent(text, m.images) : text,
    };
  });

  if (body.content) {
    messages.push({ role: 'user', content: body.content });
  }

  return { messages, droppedImageMessages, droppedFileMessages };
}
