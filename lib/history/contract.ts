/**
 * 容量契约：字节估算、附件收集、预算淘汰（doc/chat-history.md §3）。
 *
 * 全部是纯函数，IDB 与内存实现共用同一套淘汰算法——避免两套实现算出不同结果，
 * 也保证淘汰逻辑可以被 node 环境单测覆盖（IDB 本体无法在 vitest node 环境跑）。
 */
import {
  GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES,
  GLOBAL_QUOTA_RATIO,
  SESSION_ATTACHMENT_BUDGET_BYTES,
  makeBlobKey,
} from './types.ts';
import type { AttachmentRef, ExpiredImageRef, HistoryMessage, SessionMeta } from './types.ts';

/**
 * UTF-8 字节数（手写不依赖 TextEncoder：scripts/ 冒烟与 RSC 环境都能直接跑）。
 * 语义与 Node 的 Buffer.byteLength(text, 'utf8') 一致。
 */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // 代理对：两个 UTF-16 单元共同表示一个 4 字节码点，跳过低位代理
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * dataURL 解码后的字节数：base64 每 4 字符对应 3 字节。
 * 只用于容量统计，允许近似——真实内存占用另有字符串本身的开销，误差在 1/4 以内。
 */
export function dataUrlBytes(dataUrl: string): number {
  if (!dataUrl) return 0;
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.ceil((payload.length * 3) / 4);
}

/** 一条消息的文本字节数：正文 + 思维链 + 文本文件正文 */
function messageTextBytes(message: HistoryMessage): number {
  let bytes = utf8Bytes(message.content ?? '');
  if (message.reasoning) bytes += utf8Bytes(message.reasoning);
  for (const file of message.files ?? []) bytes += utf8Bytes(file.text);
  return bytes;
}

/** 整个会话的文本字节数（近似：不含结构化字段的 JSON 开销，用于列表展示与排序参考） */
export function messagesTextBytes(messages: HistoryMessage[]): number {
  return messages.reduce((sum, message) => sum + messageTextBytes(message), 0);
}

/**
 * 收集会话内的附件引用，顺序为「最旧在前」（msgIndex 升序、同条内 imgIndex 升序）。
 * 空串槽位（已过期）不计入——它们的字节数已经是 0，收集进去只会污染淘汰计划。
 */
export function collectAttachments(
  sessionId: string,
  messages: HistoryMessage[]
): AttachmentRef[] {
  const refs: AttachmentRef[] = [];
  messages.forEach((message, msgIndex) => {
    (message.images ?? []).forEach((src, imgIndex) => {
      if (!src) return;
      refs.push({
        key: makeBlobKey(sessionId, msgIndex, imgIndex),
        sessionId,
        msgIndex,
        imgIndex,
        bytes: dataUrlBytes(src),
      });
    });
  });
  return refs;
}

/** 附件总字节数 */
export function totalAttachmentBytes(items: AttachmentRef[]): number {
  return items.reduce((sum, item) => sum + item.bytes, 0);
}

/**
 * 需要腾出 needBytes 字节时该过期哪些附件：items 按最旧在前，从最早的开始累计。
 * 选中顺序与「最早先过期」口径一致；needBytes 超过总量时返回全部。
 */
export function planEvictionToFree(items: AttachmentRef[], needBytes: number): AttachmentRef[] {
  if (needBytes <= 0) return [];
  const expired: AttachmentRef[] = [];
  let freed = 0;
  for (const item of items) {
    if (freed >= needBytes) break;
    expired.push(item);
    freed += item.bytes;
  }
  return expired;
}

/**
 * 预算淘汰计划：items 必须按最旧在前排列，返回需要过期的引用（最旧在前）。
 *
 * 规则（§3.2）：合计未超预算 → 不动；超出 → 从最旧的开始逐条淘汰直到不超。
 * 极端情况下最新一张也超标时它同样入列——这张图本就不该入库。
 * 用减法而非"从最新往回填"：后者会为了保住一张大图而淘汰多张小图，与"从最早开始过期"的
 * 产品口径相反（用户看到的是最早的图先消失）。
 */
export function planEviction(items: AttachmentRef[], budget: number): AttachmentRef[] {
  if (budget <= 0) return [...items];
  const total = totalAttachmentBytes(items);
  if (total <= budget) return [];
  return planEvictionToFree(items, total - budget);
}

/** 全局附件预算：min(300MB, quota × 0.3)；quota 不可用时回落硬上限 */
export function resolveGlobalAttachmentBudget(quota?: number | null): number {
  if (typeof quota !== 'number' || !Number.isFinite(quota) || quota <= 0) {
    return GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES;
  }
  return Math.min(GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES, Math.floor(quota * GLOBAL_QUOTA_RATIO));
}

/** 单会话附件预算（当前为常量，收敛成函数便于将来按设备调整而不改调用点） */
export function resolveSessionAttachmentBudget(): number {
  return SESSION_ATTACHMENT_BUDGET_BYTES;
}

/**
 * 按淘汰结果把图片槽位置空（纯函数，返回浅拷贝的新消息数组）。
 * 只改 slots，不压缩数组：下标必须与 blob key 保持对齐。
 */
export function applyEviction(
  messages: HistoryMessage[],
  expired: AttachmentRef[]
): HistoryMessage[] {
  if (expired.length === 0) return messages;
  const byIndex = new Map<number, Set<number>>();
  for (const item of expired) {
    const slots = byIndex.get(item.msgIndex) ?? new Set<number>();
    slots.add(item.imgIndex);
    byIndex.set(item.msgIndex, slots);
  }
  return messages.map((message, msgIndex) => {
    const slots = byIndex.get(msgIndex);
    if (!slots || !message.images) return message;
    return {
      ...message,
      images: message.images.map((src, imgIndex) => (slots.has(imgIndex) ? '' : src)),
    };
  });
}

/** 引用列表折叠为过期位置，去重后按 (msg, img) 升序 */
export function toExpiredRefs(expired: AttachmentRef[]): ExpiredImageRef[] {
  const seen = new Set<string>();
  const out: ExpiredImageRef[] = [];
  for (const item of expired) {
    const key = `${item.msgIndex}:${item.imgIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ msg: item.msgIndex, img: item.imgIndex });
  }
  return out.sort((a, b) => a.msg - b.msg || a.img - b.img);
}

/** 合并已有过期位置与新增过期位置（去重 + 升序），供写库时落进 record */
export function mergeExpiredRefs(
  existing: ExpiredImageRef[],
  added: ExpiredImageRef[]
): ExpiredImageRef[] {
  const seen = new Set<string>();
  const out: ExpiredImageRef[] = [];
  for (const ref of [...existing, ...added]) {
    const key = `${ref.msg}:${ref.img}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ msg: ref.msg, img: ref.img });
  }
  return out.sort((a, b) => a.msg - b.msg || a.img - b.img);
}

/**
 * 写库前的会话头刷新：消息数/字节数/更新时间以实际内容为准，
 * 标题与 titleEdited 属于用户态，原样保留（§2.3）。
 */
export function refreshMeta(meta: SessionMeta, messages: HistoryMessage[], now: number): SessionMeta {
  const attachments = collectAttachments(meta.id, messages);
  return {
    ...meta,
    updatedAt: now,
    messageCount: messages.length,
    textBytes: messagesTextBytes(messages),
    attachmentBytes: totalAttachmentBytes(attachments),
  };
}

/** 附件槽位坐标（回填/清理用，不含字节数） */
export interface ImageSlotRef {
  key: string;
  msgIndex: number;
  imgIndex: number;
}

/** 会话内全部非空图片槽位的坐标，顺序最旧在前 */
export function collectImageSlots(sessionId: string, messages: HistoryMessage[]): ImageSlotRef[] {
  const slots: ImageSlotRef[] = [];
  messages.forEach((message, msgIndex) => {
    (message.images ?? []).forEach((src, imgIndex) => {
      if (!src) return;
      slots.push({ key: makeBlobKey(sessionId, msgIndex, imgIndex), msgIndex, imgIndex });
    });
  });
  return slots;
}

/**
 * 落库形态：把所有图片槽位置为空串（本体进 blobs 表）。
 * 长度保持不变，空串即"此处原本有图"，回填时按坐标找回。
 */
export function stripImageBodies(messages: HistoryMessage[]): HistoryMessage[] {
  return messages.map((message) =>
    message.images ? { ...message, images: message.images.map(() => '') } : message
  );
}

/** 把一个槽位填回图片本体（纯函数，返回新消息数组；越界坐标安全忽略） */
export function fillImage(
  messages: HistoryMessage[],
  msgIndex: number,
  imgIndex: number,
  dataUrl: string
): HistoryMessage[] {
  const target = messages[msgIndex];
  if (!target || !target.images || imgIndex < 0 || imgIndex >= target.images.length) return messages;
  const next = [...messages];
  next[msgIndex] = {
    ...target,
    images: target.images.map((src, index) => (index === imgIndex ? dataUrl : src)),
  };
  return next;
}

