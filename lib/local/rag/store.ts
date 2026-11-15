/*
 * RAG 向量存储与检索入口（IndexedDB）
 *
 * 协议见 doc/browser-local-inference.md §5.2：
 * - 库 notesync-local-rag：store chunks（chunkId 主键 + Float32 向量 + 卡片元数据）、
 *   store meta（嵌入模型标记）；
 * - 首次检索惰性构建索引；换嵌入模型 → meta 不匹配 → 全量重建（dtype 微漂移不触发）；
 * - 本模块只做 IO 编排，打分排序在 ./search.ts 纯函数内。
 */
import { embedTexts } from "../embedding";
import { SEED_KNOWLEDGE } from "./seed";
import { rankChunks } from "./search";
import type { KnowledgeChunk, RagHit, RagSearchOptions } from "./types";

/** 嵌入模型版本标记：变更即全量重建索引 */
export const EMBEDDING_MODEL_ID = "bge-small-zh-v1.5";

const DB_NAME = "notesync-local-rag";
const DB_VERSION = 1;
const CHUNK_STORE = "chunks";
const META_STORE = "meta";
const META_KEY = "embedding";

interface StoredChunk {
  chunkId: string;
  vector: Float32Array;
  chunk: KnowledgeChunk;
}

interface EmbeddingMeta {
  model: string;
  dim: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        db.createObjectStore(CHUNK_STORE, { keyPath: "chunkId" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 读取失败"));
  });
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 读取失败"));
  });
}

/** 重建单事务：清空 chunks、全量写入、更新 meta（半途失败整体回滚，不留脏索引） */
function idbRebuild(
  db: IDBDatabase,
  records: StoredChunk[],
  meta: EmbeddingMeta,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CHUNK_STORE, META_STORE], "readwrite");
    tx.objectStore(CHUNK_STORE).clear();
    for (const record of records) {
      tx.objectStore(CHUNK_STORE).put(record);
    }
    tx.objectStore(META_STORE).put(meta, META_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 写入失败"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 事务中止"));
  });
}

let indexPromise: Promise<void> | null = null;
let cachedChunks: StoredChunk[] | null = null;

/** 惰性构建/校验索引；失败后清空单例允许下次调用重试 */
async function buildIfStale(): Promise<void> {
  const db = await openDb();
  const [meta, stored] = await Promise.all([
    idbGet<EmbeddingMeta>(db, META_STORE, META_KEY),
    idbGetAll<StoredChunk>(db, CHUNK_STORE),
  ]);
  const needRebuild =
    !meta ||
    meta.model !== EMBEDDING_MODEL_ID ||
    stored.length !== SEED_KNOWLEDGE.length;
  if (!needRebuild) {
    cachedChunks = stored;
    return;
  }
  // 文本构成与旧服务端 RAG 保持一致：标题+正文+标签一并参与嵌入
  const texts = SEED_KNOWLEDGE.map(
    (c) => `${c.title}。${c.content}。${c.tags.join("，")}`,
  );
  const vectors = await embedTexts(texts);
  const first = vectors[0];
  if (!first) throw new Error("嵌入结果为空，无法构建索引");
  const records: StoredChunk[] = SEED_KNOWLEDGE.map((chunk, i) => {
    const vector = vectors[i];
    if (!vector) throw new Error(`嵌入结果缺失：${chunk.id}`);
    return { chunkId: chunk.id, vector, chunk };
  });
  await idbRebuild(db, records, {
    model: EMBEDDING_MODEL_ID,
    dim: first.length,
  });
  cachedChunks = records;
}

function ensureIndex(): Promise<void> {
  if (!indexPromise) {
    indexPromise = buildIfStale().catch((err) => {
      indexPromise = null;
      cachedChunks = null;
      throw err;
    });
  }
  return indexPromise;
}

/**
 * 本地知识库检索入口。失败抛错由调用方决定（聊天链路静默跳过，不回落云端）。
 */
export async function searchKnowledge(
  query: string,
  options: RagSearchOptions = {},
): Promise<RagHit[]> {
  if (typeof indexedDB === "undefined") {
    throw new Error("本地检索仅能在浏览器环境运行");
  }
  if (!query.trim()) return [];
  await ensureIndex();
  const chunks = cachedChunks ?? (await idbGetAll<StoredChunk>(await openDb(), CHUNK_STORE));
  cachedChunks = chunks;
  const [queryVector] = await embedTexts([query]);
  if (!queryVector) return [];
  return rankChunks(
    queryVector,
    query,
    chunks.map((s) => s.chunk),
    chunks.map((s) => s.vector),
    options,
  );
}
