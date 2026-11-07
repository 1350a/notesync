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

/** 请求体里与消息相关的字段 */
export interface ChatRequestBody {
  model?: string;
  messages?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    images?: string[];
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
 * 把请求体的 messages 组装成 Provider 消息序列。
 * 只有最近 MAX_IMAGE_MESSAGES 条带图消息保留图片，更早的仅发文字（多轮 base64 会线性膨胀）。
 * 返回值同时给出被丢弃图片的消息条数，供调用方按需记录日志。
 */
export function buildProviderMessages(body: ChatRequestBody): {
  messages: ProviderMessage[];
  droppedImageMessages: number;
} {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { messages: [{ role: 'user', content: body.content || '' }], droppedImageMessages: 0 };
  }

  const keepImages = new Set<number>();
  for (let i = body.messages.length - 1; i >= 0 && keepImages.size < MAX_IMAGE_MESSAGES; i -= 1) {
    const msg = body.messages[i];
    if (msg.role === 'user' && Array.isArray(msg.images) && msg.images.length > 0) {
      keepImages.add(i);
    }
  }

  let droppedImageMessages = 0;
  const messages: ProviderMessage[] = body.messages.map((m, index) => {
    const hasImages = Array.isArray(m.images) && m.images.length > 0;
    if (hasImages && !keepImages.has(index)) droppedImageMessages += 1;
    return {
      role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
      content:
        hasImages && keepImages.has(index)
          ? buildUserContent(m.content || '', m.images)
          : m.content || '',
    };
  });

  if (body.content) {
    messages.push({ role: 'user', content: body.content });
  }

  return { messages, droppedImageMessages };
}
