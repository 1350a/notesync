/*
 * RAG 检索纯函数（无 IO、无 Worker，Node 可零依赖直跑冒烟）
 *
 * 协议见 doc/browser-local-inference.md §5.3：
 *   score = 0.65 × 向量余弦 + 0.35 × 关键词覆盖率（中文 unigram+bigram 兜底）
 * 本模块不做任何嵌入/IndexedDB 调用，排序与打分全部纯函数。
 */
import type { KnowledgeChunk, RagHit, RagSearchOptions } from "./types";

/** 混合检索权重（对齐旧服务端 lib/rag/store.ts 设计） */
export const VECTOR_WEIGHT = 0.65;
export const KEYWORD_WEIGHT = 0.35;

export const DEFAULT_TOP_K = 4;
export const DEFAULT_MIN_SCORE = 0.05;

/** 从文本提取中文检索单元：字符 unigram + bigram（保留中文/字母/数字） */
export function tokenizeText(text: string): string[] {
  const chars: string[] = [];
  for (const ch of text.toLowerCase()) {
    if (/[\u4e00-\u9fa5a-z0-9]/.test(ch)) chars.push(ch);
  }
  const tokens = [...chars];
  for (let i = 0; i < chars.length - 1; i++) {
    tokens.push(chars[i] + chars[i + 1]);
  }
  return tokens;
}

/** 关键词覆盖率：query 检索单元在文档中的命中比例 */
export function keywordScore(query: string, text: string): number {
  const qTokens = new Set(tokenizeText(query));
  if (qTokens.size === 0) return 0;
  const docTokens = new Set(tokenizeText(text));
  let hit = 0;
  for (const t of qTokens) if (docTokens.has(t)) hit++;
  return hit / qTokens.size;
}

/** 余弦相似度（归一化向量可直接点乘；非归一化输入按模长修正） */
export function cosineSimilarity(
  a: Float32Array | number[],
  b: Float32Array | number[],
): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  // 钳制到 [0,1]：浮点误差可能产生略超 1 的值
  return Math.max(0, Math.min(1, dot / denom));
}

/** 混合评分 */
export function hybridScore(vectorScore: number, keyword: number): number {
  return VECTOR_WEIGHT * vectorScore + KEYWORD_WEIGHT * keyword;
}

/**
 * 切块纯函数（按段落切分、超长段按句边界再切；v1 语料为种子卡一卡一块，
 * 本函数预留给用户笔记语料，暂无调用方但含冒烟用例）
 * @param maxLen 单块字符上限
 */
export function chunkText(text: string, maxLen = 500): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxLen) {
      out.push(para);
      continue;
    }
    // 超长段：按句边界切分后聚合，避免句子被拦腰截断
    const sentences = para.split(/(?<=[。！？!?])/);
    let buffer = "";
    for (const sentence of sentences) {
      if (buffer.length + sentence.length > maxLen && buffer) {
        out.push(buffer);
        buffer = "";
      }
      buffer += sentence;
    }
    if (buffer) out.push(buffer);
  }
  return out;
}

/**
 * 取前 k 条（纯函数，无 IO）：k 非有限数或 ≤ 0 返回空数组，k 超长时返回全部。
 * 与 rankChunks 解耦，便于冒烟脚本单独覆盖边界；文档 §5.3 列明的纯函数之一。
 */
export function topK<T>(items: readonly T[], k: number): T[] {
  const limit = Number.isFinite(k) ? Math.floor(k) : 0;
  if (limit <= 0 || items.length === 0) return [];
  return items.slice(0, limit);
}

/** 混合检索：纯函数入口，向量与语料全部由调用方提供 */
export function rankChunks(
  queryVector: Float32Array,
  query: string,
  chunks: KnowledgeChunk[],
  vectors: Float32Array[],
  options: RagSearchOptions = {},
): RagHit[] {
  const {
    kind,
    subject,
    topK: topKLimit = DEFAULT_TOP_K,
    minScore = DEFAULT_MIN_SCORE,
  } = options;

  const scored: RagHit[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = vectors[i];
    if (!chunk || !vector) continue;
    if (kind && chunk.kind !== kind) continue;
    if (subject && chunk.subject !== subject) continue;

    const vs = cosineSimilarity(queryVector, vector);
    const ks = keywordScore(
      query,
      `${chunk.title}。${chunk.content}。${chunk.tags.join("，")}`,
    );
    const score = hybridScore(vs, ks);
    if (score < minScore) continue;
    scored.push({ chunk, vectorScore: vs, keywordScore: ks, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return topK(scored, topKLimit);
}
