/**
 * 会话历史的非 IndexedDB 实现：内存存储 + 空实现（doc/chat-history.md §4）。
 *
 * 内存实现与 IDB 实现共用 contract.ts 的同一套淘汰算法，且同样把图片本体与消息体分离，
 * 因此单测覆盖到的是真实写库路径，不是另写一套"测试专用逻辑"。
 * 空实现用于 IDB 不可用（隐私模式/禁用站点数据）时的整体降级：写入全部丢弃，读取恒为空。
 */
import {
  applyEviction,
  collectAttachments,
  collectImageSlots,
  dataUrlBytes,
  fillImage,
  mergeExpiredRefs,
  planEviction,
  refreshMeta,
  resolveGlobalAttachmentBudget,
  resolveSessionAttachmentBudget,
  stripImageBodies,
  toExpiredRefs,
  totalAttachmentBytes,
} from './contract.ts';
import { sanitizeExpiredRefs, sanitizeMessages } from './sanitize.ts';
import { normalizeTitle } from './title.ts';
import { UNTITLED_SESSION, parseBlobKey } from './types.ts';
import type {
  AttachmentRef,
  ExpiredImageRef,
  HistoryMessage,
  HistoryStorage,
  SaveResult,
  SessionMeta,
  SessionRecord,
  StorageEstimate,
} from './types.ts';

export interface MemoryHistoryOptions {
  /** 模拟 navigator.storage.estimate().quota；缺省 0（= 取不到配额，回落硬上限） */
  quota?: number;
  /** 模拟配额耗尽：本次附件全部不入库（降级路径测试用） */
  failAttachmentWrite?: boolean;
  /** 注入时钟，保证时间相关断言稳定 */
  now?: () => number;
}

interface MemorySession {
  meta: SessionMeta;
  /** 落库形态：图片槽位全为空串，本体在 blobs */
  messages: HistoryMessage[];
  expiredImages: ExpiredImageRef[];
  blobs: Map<string, string>;
}

/** 会话在内存中的附件引用（最旧在前），用于全局淘汰 */
function sessionAttachments(session: MemorySession): AttachmentRef[] {
  const items: AttachmentRef[] = [];
  for (const [key, body] of session.blobs) {
    const parsed = parseBlobKey(key);
    if (!parsed) continue;
    items.push({
      key: parsed.key,
      sessionId: session.meta.id,
      msgIndex: parsed.msgIndex,
      imgIndex: parsed.imgIndex,
      bytes: dataUrlBytes(body),
    });
  }
  return items.sort((a, b) => a.msgIndex - b.msgIndex || a.imgIndex - b.imgIndex);
}

/** 按当前 blobs 重算附件字节数（淘汰后必须同步，否则列表页容量显示会虚高） */
function recomputeAttachmentBytes(session: MemorySession): number {
  return totalAttachmentBytes(sessionAttachments(session));
}

function cloneMeta(meta: SessionMeta): SessionMeta {
  return { ...meta };
}

function cloneRecord(session: MemorySession, messages: HistoryMessage[]): SessionRecord {
  return {
    id: session.meta.id,
    messages,
    expiredImages: session.expiredImages.map((ref) => ({ ...ref })),
  };
}

export function createMemoryHistoryStorage(options: MemoryHistoryOptions = {}): HistoryStorage {
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, MemorySession>();

  /** 全局淘汰：跨会话按 updatedAt 升序、会话内最旧在前，超出全局预算即从最早附件开始过期 */
  function rebalanceGlobal(): void {
    const budget = resolveGlobalAttachmentBudget(options.quota);
    const ordered = [...sessions.values()].sort((a, b) => a.meta.updatedAt - b.meta.updatedAt);
    const flattened: AttachmentRef[] = [];
    for (const session of ordered) flattened.push(...sessionAttachments(session));

    const expired = planEviction(flattened, budget);
    if (expired.length === 0) return;

    const bySession = new Map<string, AttachmentRef[]>();
    for (const item of expired) {
      const list = bySession.get(item.sessionId) ?? [];
      list.push(item);
      bySession.set(item.sessionId, list);
    }
    for (const [sessionId, items] of bySession) {
      const session = sessions.get(sessionId);
      if (!session) continue;
      for (const item of items) session.blobs.delete(item.key);
      session.expiredImages = mergeExpiredRefs(session.expiredImages, toExpiredRefs(items));
      session.meta = { ...session.meta, attachmentBytes: recomputeAttachmentBytes(session) };
    }
  }

  const storage: HistoryStorage = {
    supported: true,

    async listSessions() {
      return [...sessions.values()]
        .map((session) => cloneMeta(session.meta))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async loadSession(id: string) {
      const session = sessions.get(id);
      if (!session) return null;
      let messages = session.messages;
      // 槽位全为空串，逐个从 blobs 回填；结构顺序不影响结果，故不排序
      for (const [key, body] of session.blobs) {
        const parsed = parseBlobKey(key);
        if (!parsed) continue;
        messages = fillImage(messages, parsed.msgIndex, parsed.imgIndex, body);
      }
      return cloneRecord(session, messages);
    },

    async saveSession(meta: SessionMeta, record: SessionRecord) {
      const messages = sanitizeMessages(record.messages);
      const previous = sessions.get(meta.id);

      // 第一级：单会话预算，超了过期本会话最早的附件
      const sessionBudget = resolveSessionAttachmentBudget();
      const sessionAttachmentsAll = collectAttachments(meta.id, messages);
      const expiredInSession = planEviction(sessionAttachmentsAll, sessionBudget);
      let finalMessages = applyEviction(messages, expiredInSession);
      const dropped: AttachmentRef[] = [...expiredInSession];

      // 第二级：落库形态（图片本体进 blobs）
      const blobs = new Map<string, string>();
      for (const slot of collectImageSlots(meta.id, finalMessages)) {
        const message = finalMessages[slot.msgIndex];
        const body = message.images?.[slot.imgIndex];
        if (body) blobs.set(slot.key, body);
      }

      // 配额耗尽：本次附件一律不入库、全部登记过期，文本照存（不阻断发送）
      let writeFailed = false;
      if (options.failAttachmentWrite && blobs.size > 0) {
        writeFailed = true;
        dropped.push(...collectAttachments(meta.id, finalMessages));
        finalMessages = applyEviction(finalMessages, dropped);
        blobs.clear();
      }

      // 标题：用户手改过的优先，自动派生值不得覆盖（§2.3）
      const titleEdited = meta.titleEdited || previous?.meta.titleEdited === true;
      const title =
        previous?.meta.titleEdited && !meta.titleEdited
          ? previous.meta.title
          : normalizeTitle(meta.title) ?? UNTITLED_SESSION;
      const stored: MemorySession = {
        meta: refreshMeta({ ...meta, title, titleEdited }, finalMessages, now()),
        messages: stripImageBodies(finalMessages),
        expiredImages: sanitizeExpiredRefs(
          mergeExpiredRefs(record.expiredImages ?? [], toExpiredRefs(dropped)),
          finalMessages.length
        ),
        blobs,
      };
      sessions.set(meta.id, stored);

      // 全局预算只对成功写入的附件做二次淘汰；配额失败时附件本就没进来，无需再动
      if (!writeFailed) rebalanceGlobal();

      const result = sessions.get(meta.id) ?? stored;
      const payload: SaveResult = {
        status: writeFailed ? 'saved-without-attachments' : 'saved',
        // 语义与 IDB 实现一致：返回该会话当前全部过期坐标（幂等，跨会话淘汰由下次读取反映）
        expired: result.expiredImages,
        textBytes: result.meta.textBytes,
        attachmentBytes: result.meta.attachmentBytes,
      };
      return payload;
    },

    async renameSession(id: string, title: string) {
      const session = sessions.get(id);
      const normalized = normalizeTitle(title);
      if (!session || !normalized) return false;
      // 手改标题后置 titleEdited，自动派生不再覆盖（§2.3）；updatedAt 不动，改标题不该改变会话排序
      session.meta = { ...session.meta, title: normalized, titleEdited: true };
      return true;
    },

    async deleteSession(id: string) {
      sessions.delete(id);
    },

    async loadBlob(key: string) {
      const parsed = parseBlobKey(key);
      if (!parsed) return null;
      return sessions.get(parsed.sessionId)?.blobs.get(key) ?? null;
    },

    async estimate(): Promise<StorageEstimate> {
      const usage = [...sessions.values()].reduce(
        (sum, session) => sum + session.meta.attachmentBytes,
        0
      );
      return { usage, quota: options.quota ?? 0 };
    },

    async clearAll() {
      sessions.clear();
    },
  };

  return storage;
}

/**
 * IDB 不可用时的空实现：所有写入静默丢弃、读取恒为空。
 * 会话仍可在内存中正常使用（由 store 持有），只是刷新即丢——与 §4 的降级口径一致。
 */
export function createNoopHistoryStorage(): HistoryStorage {
  return {
    supported: false,
    async listSessions() {
      return [];
    },
    async loadSession() {
      return null;
    },
    async saveSession(): Promise<SaveResult> {
      return { status: 'unsupported', expired: [], textBytes: 0, attachmentBytes: 0 };
    },
    async renameSession() {
      return false;
    },
    async deleteSession() {
      // no-op
    },
    async loadBlob() {
      return null;
    },
    async estimate(): Promise<StorageEstimate> {
      return { usage: 0, quota: 0 };
    },
    async clearAll() {
      // no-op
    },
  };
}
