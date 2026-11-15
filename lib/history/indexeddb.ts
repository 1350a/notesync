/**
 * 会话历史的 IndexedDB 实现（doc/chat-history.md §2、§3、§4）。
 *
 * 三张表：meta（会话头）、records（消息，图片槽位全空）、blobs（附件本体）。
 * 所有失败路径都以返回值表达，绝不抛错：IDB 在隐私模式、配额满、库版本冲突时会以
 * 各种姿态失败，任何一次抛错都不该让聊天页崩掉。
 *
 * 事务纪律：同一个事务内绝不在 await 之后再发请求——IDB 事务在没有挂起请求时会自动
 * 提交，后续 put 会抛 TransactionInactiveError。因此统一「先只读事务取数据，再开写事务」。
 */
import {
  applyEviction,
  collectAttachments,
  collectImageSlots,
  dataUrlBytes,
  fillImage,
  mergeExpiredRefs,
  planEviction,
  planEvictionToFree,
  refreshMeta,
  resolveGlobalAttachmentBudget,
  resolveSessionAttachmentBudget,
  stripImageBodies,
  toExpiredRefs,
} from './contract.ts';
import { createNoopHistoryStorage } from './memory.ts';
import { sanitizeExpiredRefs, sanitizeMeta, sanitizeMessages, sanitizeRecord } from './sanitize.ts';
import { normalizeTitle } from './title.ts';
import {
  HISTORY_DB_NAME,
  HISTORY_DB_VERSION,
  STORE_BLOBS,
  STORE_META,
  STORE_RECORDS,
  UNTITLED_SESSION,
  parseBlobKey,
} from './types.ts';
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

/** blobs 表的行：key 为 `sessionId:msgIndex:imgIndex`；bytes 落库避免淘汰时重算 base64 长度 */
interface BlobEntry {
  key: string;
  body: string;
  bytes: number;
}

/**
 * 环境探测。SSR 与"禁用站点数据"的环境都没有可用的 indexedDB；
 * 私有模式下部分浏览器给了对象但 open() 会抛 SecurityError，由各方法兜住。
 */
export function isIndexedDbAvailable(): boolean {
  try {
    return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;
  } catch {
    return false;
  }
}

/** IDBRequest → Promise */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

/** 事务完成 → Promise（写操作必须等 oncomplete，onsuccess 只代表请求入队成功） */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中断'));
  });
}

/** 会话内 blobs 的键区间：只碰本会话，避免遍历全表 */
function sessionKeyRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${sessionId}:`, `${sessionId}:\uffff`);
}

/** 配额错误识别：各浏览器 message 不一致但 name 稳定（QuotaExceededError），只认 name */
function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/** 浏览器配额；取不到返回 0，由 resolveGlobalAttachmentBudget 回落硬上限 */
async function readQuota(): Promise<number> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return 0;
    const { quota } = await navigator.storage.estimate();
    return typeof quota === 'number' && quota > 0 ? quota : 0;
  } catch {
    return 0;
  }
}

/** 申请持久化存储（§3.3）：结果仅供日志，不阻塞任何流程 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** blobs 行 → 淘汰算法需要的附件引用，顺序最旧在前 */
function toAttachmentRefs(sessionId: string, entries: BlobEntry[]): AttachmentRef[] {
  return entries
    .map((entry) => {
      const parsed = parseBlobKey(entry.key);
      if (!parsed) return null;
      return {
        key: parsed.key,
        sessionId,
        msgIndex: parsed.msgIndex,
        imgIndex: parsed.imgIndex,
        bytes: entry.bytes,
      } satisfies AttachmentRef;
    })
    .filter((ref): ref is AttachmentRef => ref !== null)
    .sort((a, b) => a.msgIndex - b.msgIndex || a.imgIndex - b.imgIndex);
}

export function createIndexedDbHistoryStorage(): HistoryStorage {
  if (!isIndexedDbAvailable()) return createNoopHistoryStorage();

  let dbPromise: Promise<IDBDatabase> | null = null;
  let persistentRequested = false;

  function openDatabase(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        // 升级只加不删：老版本数据必须原地可读（§2.2）
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
      request.onblocked = () => reject(new Error('IndexedDB 被其他标签页占用'));
    }).catch((error: unknown) => {
      // 失败不缓存，允许下次调用重试（用户可能刚关掉占用连接的旧标签页）
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }

  /** 读全部会话头；meta 表很小，全量读可接受（列表与淘汰共用） */
  async function readAllMetas(db: IDBDatabase): Promise<SessionMeta[]> {
    const tx = db.transaction(STORE_META, 'readonly');
    const rows = await requestToPromise(tx.objectStore(STORE_META).getAll());
    return rows.map(sanitizeMeta).filter((meta): meta is SessionMeta => meta !== null);
  }

  /** 读单条记录；不存在或损坏返回 null */
  async function readRecord(db: IDBDatabase, id: string): Promise<SessionRecord | null> {
    const tx = db.transaction(STORE_RECORDS, 'readonly');
    return sanitizeRecord(await requestToPromise(tx.objectStore(STORE_RECORDS).get(id)));
  }

  /** 读单条会话头；不存在或损坏返回 null */
  async function readMeta(db: IDBDatabase, id: string): Promise<SessionMeta | null> {
    const tx = db.transaction(STORE_META, 'readonly');
    return sanitizeMeta(await requestToPromise(tx.objectStore(STORE_META).get(id)));
  }

  /** 读某会话的全部附件行（冷路径：只在淘汰与读取会话时调用） */
  async function readSessionBlobs(db: IDBDatabase, sessionId: string): Promise<BlobEntry[]> {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const rows = await requestToPromise(
      tx.objectStore(STORE_BLOBS).getAll(sessionKeyRange(sessionId))
    );
    return rows as BlobEntry[];
  }

  /**
   * 全局预算淘汰：从最旧会话的最早附件开始删，直到全局合计不超预算。
   * 必须同步更新被删会话的 record.expiredImages 与 meta.attachmentBytes，
   * 否则渲染层拿不到「图片已过期」的依据、列表容量也会虚高。
   */
  async function evictGlobally(db: IDBDatabase, budget: number): Promise<void> {
    const metas = await readAllMetas(db);
    let usage = metas.reduce((sum, meta) => sum + meta.attachmentBytes, 0);
    if (usage <= budget) return;

    const ordered = [...metas].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const meta of ordered) {
      if (usage <= budget) return;
      const blobs = await readSessionBlobs(db, meta.id);
      if (blobs.length === 0) continue;

      const refs = toAttachmentRefs(meta.id, blobs);
      const expired = planEvictionToFree(refs, usage - budget);
      if (expired.length === 0) continue;

      const record = await readRecord(db, meta.id);
      const expiredKeys = new Set<string>(expired.map((item) => item.key));
      const remainingBytes = blobs
        .filter((entry) => !expiredKeys.has(entry.key))
        .reduce((sum, entry) => sum + entry.bytes, 0);

      const tx = db.transaction([STORE_BLOBS, STORE_RECORDS, STORE_META], 'readwrite');
      const blobStore = tx.objectStore(STORE_BLOBS);
      for (const item of expired) blobStore.delete(item.key);
      if (record) {
        tx.objectStore(STORE_RECORDS).put({
          ...record,
          expiredImages: mergeExpiredRefs(record.expiredImages, toExpiredRefs(expired)),
        });
      }
      tx.objectStore(STORE_META).put({ ...meta, attachmentBytes: remainingBytes });
      await transactionDone(tx);

      for (const item of expired) usage -= item.bytes;
    }
  }

  /** 写入一个会话：附件、消息体、会话头三处同批成功（同事务内不发 await） */
  async function writeSession(
    db: IDBDatabase,
    meta: SessionMeta,
    record: SessionRecord,
    withAttachments: boolean
  ): Promise<SaveResult> {
    const messages = sanitizeMessages(record.messages);

    // 第一级：单会话预算，超了过期本会话最早的附件
    const expiredInSession = planEviction(
      collectAttachments(meta.id, messages),
      resolveSessionAttachmentBudget()
    );
    let finalMessages = applyEviction(messages, expiredInSession);
    const dropped: AttachmentRef[] = [...expiredInSession];

    // 第二级：拆分附件本体；配额失败时本次附件一律不入库并全部登记过期
    const blobs: BlobEntry[] = [];
    if (withAttachments) {
      for (const slot of collectImageSlots(meta.id, finalMessages)) {
        const body = finalMessages[slot.msgIndex].images?.[slot.imgIndex];
        if (body) blobs.push({ key: slot.key, body, bytes: dataUrlBytes(body) });
      }
    } else {
      dropped.push(...collectAttachments(meta.id, finalMessages));
      finalMessages = applyEviction(finalMessages, dropped);
    }

    // 标题：用户手改过的优先，自动派生值不得覆盖（§2.3）
    const previousMeta = await readMeta(db, meta.id);
    const titleEdited = meta.titleEdited === true || previousMeta?.titleEdited === true;
    const title =
      previousMeta?.titleEdited && meta.titleEdited !== true
        ? previousMeta.title
        : normalizeTitle(meta.title) ?? UNTITLED_SESSION;
    const freshMeta = refreshMeta({ ...meta, title, titleEdited }, finalMessages, Date.now());
    const storedRecord: SessionRecord = {
      id: meta.id,
      messages: stripImageBodies(finalMessages),
      expiredImages: sanitizeExpiredRefs(
        mergeExpiredRefs(record.expiredImages ?? [], toExpiredRefs(dropped)),
        finalMessages.length
      ),
    };

    const tx = db.transaction([STORE_BLOBS, STORE_RECORDS, STORE_META], 'readwrite');
    const blobStore = tx.objectStore(STORE_BLOBS);
    // 覆盖写语义：先清本会话旧附件，避免删消息后留下孤儿 blob
    blobStore.delete(sessionKeyRange(meta.id));
    for (const blob of blobs) blobStore.put(blob);
    tx.objectStore(STORE_RECORDS).put(storedRecord);
    tx.objectStore(STORE_META).put(freshMeta);
    await transactionDone(tx);

    if (!persistentRequested) {
      persistentRequested = true;
      void requestPersistentStorage();
    }

    return {
      status: withAttachments ? 'saved' : 'saved-without-attachments',
      expired: storedRecord.expiredImages,
      textBytes: freshMeta.textBytes,
      attachmentBytes: blobs.reduce((sum, blob) => sum + blob.bytes, 0),
    };
  }

  return {
    supported: true,

    async listSessions() {
      try {
        const db = await openDatabase();
        const metas = await readAllMetas(db);
        return metas.sort((a, b) => b.updatedAt - a.updatedAt);
      } catch (error) {
        console.warn('[history] 读取会话列表失败', error);
        return [];
      }
    },

    async loadSession(id: string) {
      try {
        const db = await openDatabase();
        const record = await readRecord(db, id);
        if (!record) return null;

        const entries = await readSessionBlobs(db, id);
        let messages: HistoryMessage[] = record.messages;
        const missing: ExpiredImageRef[] = [];
        for (const entry of entries) {
          const parsed = parseBlobKey(entry.key);
          if (!parsed) continue;
          const before = messages;
          messages = fillImage(messages, parsed.msgIndex, parsed.imgIndex, entry.body);
          // 坐标越界（例如消息被删）视为该附件丢失：登记过期而不是静默丢进黑洞
          if (messages === before) missing.push({ msg: parsed.msgIndex, img: parsed.imgIndex });
        }
        return {
          id: record.id,
          messages,
          expiredImages: mergeExpiredRefs(record.expiredImages, missing),
        };
      } catch (error) {
        console.warn('[history] 读取会话失败', error);
        return null;
      }
    },

    async saveSession(meta: SessionMeta, record: SessionRecord) {
      try {
        const db = await openDatabase();
        const budget = resolveGlobalAttachmentBudget(await readQuota());
        const result = await writeSession(db, meta, record, true);
        await evictGlobally(db, budget);
        return result;
      } catch (error) {
        if (!isQuotaError(error)) {
          console.warn('[history] 会话写库失败', error);
          return { status: 'unsupported', expired: [], textBytes: 0, attachmentBytes: 0 };
        }
        // 配额满：退回「只存文本」再试一次，仍失败则认输（§4）
        try {
          const db = await openDatabase();
          return await writeSession(db, meta, record, false);
        } catch (retryError) {
          console.warn('[history] 会话写库重试失败（配额）', retryError);
          return { status: 'unsupported', expired: [], textBytes: 0, attachmentBytes: 0 };
        }
      }
    },

    async renameSession(id: string, title: string) {
      const normalized = normalizeTitle(title);
      if (!normalized) return false;
      try {
        const db = await openDatabase();
        const meta = sanitizeMeta(
          await requestToPromise(
            db.transaction(STORE_META, 'readonly').objectStore(STORE_META).get(id)
          )
        );
        if (!meta) return false;
        const tx = db.transaction(STORE_META, 'readwrite');
        // 手改标题置 titleEdited（§2.3）；updatedAt 不动，改标题不该改变会话排序
        tx.objectStore(STORE_META).put({ ...meta, title: normalized, titleEdited: true });
        await transactionDone(tx);
        return true;
      } catch (error) {
        console.warn('[history] 会话改名失败', error);
        return false;
      }
    },

    async deleteSession(id: string) {
      try {
        const db = await openDatabase();
        const tx = db.transaction([STORE_BLOBS, STORE_RECORDS, STORE_META], 'readwrite');
        tx.objectStore(STORE_BLOBS).delete(sessionKeyRange(id));
        tx.objectStore(STORE_RECORDS).delete(id);
        tx.objectStore(STORE_META).delete(id);
        await transactionDone(tx);
      } catch (error) {
        console.warn('[history] 会话删除失败', error);
      }
    },

    async loadBlob(key: string) {
      try {
        const db = await openDatabase();
        const row = (await requestToPromise(
          db.transaction(STORE_BLOBS, 'readonly').objectStore(STORE_BLOBS).get(key)
        )) as BlobEntry | undefined;
        return row?.body ?? null;
      } catch {
        return null;
      }
    },

    async estimate(): Promise<StorageEstimate> {
      try {
        const db = await openDatabase();
        const metas = await readAllMetas(db);
        return {
          usage: metas.reduce((sum, meta) => sum + meta.attachmentBytes, 0),
          quota: await readQuota(),
        };
      } catch {
        return { usage: 0, quota: 0 };
      }
    },

    async clearAll() {
      try {
        const db = await openDatabase();
        const tx = db.transaction([STORE_BLOBS, STORE_RECORDS, STORE_META], 'readwrite');
        tx.objectStore(STORE_BLOBS).clear();
        tx.objectStore(STORE_RECORDS).clear();
        tx.objectStore(STORE_META).clear();
        await transactionDone(tx);
      } catch (error) {
        console.warn('[history] 清空会话历史失败', error);
      }
    },
  };
}
