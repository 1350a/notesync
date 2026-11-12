/**
 * 会话历史 - 类型、常量与存储接口。
 *
 * 消费方（store / 组件）只依赖 HistoryStorage 接口；当前实现为 IndexedDB，
 * 测试与降级场景用内存实现（协议见 doc/chat-history.md §2、§4）。
 * 导入统一带 .ts 后缀：与 lib/tools、lib/settings 同款约定，保证 scripts/ 冒烟可零依赖直跑。
 */
import type { ChatMsg } from '../chat/messages.ts';

/** IndexedDB 库名与版本：升级只加表不删字段（doc/chat-history.md §2.2） */
export const HISTORY_DB_NAME = 'notesync-chat-history';
export const HISTORY_DB_VERSION = 1;

export const STORE_META = 'meta';
export const STORE_RECORDS = 'records';
export const STORE_BLOBS = 'blobs';

/** 单会话附件预算 20MB（doc/chat-history.md §3.1） */
export const SESSION_ATTACHMENT_BUDGET_BYTES = 20 * 1024 * 1024;
/** 全局附件预算硬上限 300MB；实际取 min(本值, quota × GLOBAL_QUOTA_RATIO) */
export const GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES = 300 * 1024 * 1024;
/** 全局预算占浏览器配额的比例 */
export const GLOBAL_QUOTA_RATIO = 0.3;

/** 标题字符上限（按码点计，避免 emoji 被劈开） */
export const MAX_TITLE_CHARS = 20;
/** 无有效正文时的会话标题 */
export const UNTITLED_SESSION = '新对话';

/** 单条消息正文字符上限：与 lib/chat/messages.ts 的文本口径同量级，超长截断 */
export const MAX_MESSAGE_CHARS = 200_000;
/** 单条消息携带的图片槽位上限（含已过期占位），防止脏数据把数组撑爆 */
export const MAX_IMAGES_PER_MESSAGE = 16;

/** 写库防抖窗口：流式生成结束后合并成一次事务（doc/chat-history.md §2.6） */
export const SAVE_DEBOUNCE_MS = 700;

/** 会话列表项：列表页只读此结构，不读消息体 */
export interface SessionMeta {
  id: string;
  title: string;
  /** 创建时间（epoch ms） */
  createdAt: number;
  /** 最后活动时间（epoch ms），列表按此倒序 */
  updatedAt: number;
  messageCount: number;
  /** 文本字节数（近似：content / reasoning / files 文本之和，不含结构化字段开销） */
  textBytes: number;
  /** 附件字节数（各图片 dataURL 解码后大小之和） */
  attachmentBytes: number;
  /** 用户手改过标题：置 true 后自动派生逻辑不再覆盖 */
  titleEdited: boolean;
}

/**
 * 落库消息：ChatMsg + 可选稳定 id。
 * id 仅用于去重与 React key，缺省时按位置重建（doc/chat-history.md §2.3）。
 */
export type HistoryMessage = ChatMsg & { id?: string };

/** 过期附件位置；images 槽位与 blob key 严格对齐，故用下标而非 key 记录 */
export interface ExpiredImageRef {
  msg: number;
  img: number;
}

/** 单会话消息体：图片槽位一律为空串，本体在 blobs 表（doc/chat-history.md §2.2） */
export interface SessionRecord {
  id: string;
  messages: HistoryMessage[];
  /** 已过期的图片位置（渲染时显示「图片已过期」） */
  expiredImages: ExpiredImageRef[];
}

/** 附件键：`sessionId:msgIndex:imgIndex` */
export type BlobKey = `${string}:${number}:${number}`;

/** 附件引用：预算淘汰与过期计算的输入单元 */
export interface AttachmentRef {
  key: BlobKey;
  sessionId: string;
  msgIndex: number;
  imgIndex: number;
  bytes: number;
}

/** 保存结果状态：unsupported 表示整库降级为内存，saved-without-attachments 表示附件被配额挡下 */
export type SaveStatus = 'saved' | 'saved-without-attachments' | 'unsupported';

export interface SaveResult {
  status: SaveStatus;
  /** 本次因预算淘汰或配额失败而置为过期的位置（最旧在前） */
  expired: ExpiredImageRef[];
  /** 本次落库的文本字节数 */
  textBytes: number;
  /** 本次实际落库的附件字节数（不含被淘汰项） */
  attachmentBytes: number;
}

export interface StorageEstimate {
  /** 各会话 attachmentBytes 之和 */
  usage: number;
  /** 浏览器配额；取不到时为 0（调用方按硬上限回落） */
  quota: number;
}

/**
 * 会话历史存储接口。所有方法异步：IDB 天然异步，内存实现保持同一签名，
 * 消费方无需区分实现。任何方法都不得抛错——故障一律以 null / 空数组 / SaveResult.status 表达。
 */
export interface HistoryStorage {
  /** 本环境是否可持久化；false 时消费方须提示「本次对话不会留存」并只走内存态 */
  readonly supported: boolean;
  listSessions(): Promise<SessionMeta[]>;
  /** 读会话并把 blob 回填进 messages；不存在或损坏返回 null */
  loadSession(id: string): Promise<SessionRecord | null>;
  /** 整条覆盖写：写前按预算淘汰（§3.2），写失败按 §4 降级 */
  saveSession(meta: SessionMeta, record: SessionRecord): Promise<SaveResult>;
  renameSession(id: string, title: string): Promise<boolean>;
  deleteSession(id: string): Promise<void>;
  /** 单张附件按需读取；缺失返回 null（渲染为「图片已过期」） */
  loadBlob(key: string): Promise<string | null>;
  estimate(): Promise<StorageEstimate>;
  clearAll(): Promise<void>;
}

/** 生成附件键（导出以便测试与清理逻辑复用） */
export function makeBlobKey(sessionId: string, msgIndex: number, imgIndex: number): BlobKey {
  return `${sessionId}:${msgIndex}:${imgIndex}`;
}

/** 解析附件键；任何不合规输入返回 null（脏 key 一律忽略） */
export function parseBlobKey(key: string): Omit<AttachmentRef, 'bytes'> | null {
  if (typeof key !== 'string') return null;
  const first = key.indexOf(':');
  const last = key.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;
  const sessionId = key.slice(0, first);
  const msgIndex = Number(key.slice(first + 1, last));
  const imgIndex = Number(key.slice(last + 1));
  if (!Number.isInteger(msgIndex) || msgIndex < 0) return null;
  if (!Number.isInteger(imgIndex) || imgIndex < 0) return null;
  return { key: key as BlobKey, sessionId, msgIndex, imgIndex };
}

/** 空会话头部：新建对话时使用，时间戳由调用方给出 */
export function createSessionMeta(id: string, now: number): SessionMeta {
  return {
    id,
    title: UNTITLED_SESSION,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    textBytes: 0,
    attachmentBytes: 0,
    titleEdited: false,
  };
}
