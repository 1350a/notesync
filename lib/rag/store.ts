/*
 * =====================================================================
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：lib\rag\store.ts
 * 说明：简易重构后无活跃引用、不再参与编译链路；此处逐行注释保留原文。
 * 恢复：git checkout -- lib/rag/store.ts（如已提交），或删除各行前缀 "// "。
 * =====================================================================
 */
// /**
//  * RAG 知识库 - 向量存储与混合检索
//  *
//  * 设计：
//  * - 数据源：内置种子知识库（seed.ts） + 可选 data/knowledge.json 追加
//  * - 索引：启动后首次检索时惰性构建（嵌入 + 归一化），进程内缓存
//  * - 检索：混合检索 = 向量余弦相似度（语义）+ 关键词重合率（字面），加权融合
//  * - 检索结果带来源标题，供 Agent 作为证据回填上下文
//  */
// import { SEED_KNOWLEDGE } from "./seed";
// import { embedTexts, tokenizeText, cosineSimilarity, hashEmbed } from "./embedding";
// import type {
//   KnowledgeChunk,
//   RagHit,
//   RagSearchOptions,
//   RagSearchResult,
//   VectorItem,
// } from "./types";
// import { readFileSync, existsSync } from "node:fs";
// import path from "node:path";
// 
// /** 关键词检索权重（向量 0.65 / 关键词 0.35） */
// const VECTOR_WEIGHT = 0.65;
// const KEYWORD_WEIGHT = 0.35;
// 
// /** 从 data/knowledge.json 加载用户追加素材（文件不存在则跳过） */
// function loadExternalChunks(): KnowledgeChunk[] {
//   try {
//     const file = path.join(process.cwd(), "data", "knowledge.json");
//     if (!existsSync(file)) return [];
//     const raw = readFileSync(file, "utf-8");
//     const parsed = JSON.parse(raw) as { chunks?: KnowledgeChunk[] };
//     if (!Array.isArray(parsed.chunks)) return [];
//     return parsed.chunks.filter(
//       (c): c is KnowledgeChunk =>
//         Boolean(c && typeof c.id === "string" && typeof c.title === "string")
//     );
//   } catch {
//     return [];
//   }
// }
// 
// /** 全部知识块（种子 + 外部） */
// export function getAllChunks(): KnowledgeChunk[] {
//   return [...SEED_KNOWLEDGE, ...loadExternalChunks()];
// }
// 
// interface RagIndex {
//   chunks: KnowledgeChunk[];
//   vectors: VectorItem[];
//   usedEmbedding: boolean;
//   embeddingModel: string;
// }
// 
// let indexPromise: Promise<RagIndex> | null = null;
// 
// /** 惰性构建索引（嵌入全部知识块，进程内缓存） */
// export function getIndex(): Promise<RagIndex> {
//   if (!indexPromise) {
//     indexPromise = (async () => {
//       const chunks = getAllChunks();
//       const { vectors, usedEmbedding, model } = await embedTexts(
//         chunks.map((c) => `${c.title}。${c.content}。${c.tags.join("，")}`)
//       );
//       return {
//         chunks,
//         vectors: chunks.map((c, i) => ({ chunkId: c.id, vector: vectors[i] })),
//         usedEmbedding,
//         embeddingModel: model,
//       };
//     })();
//   }
//   return indexPromise;
// }
// 
// /** 关键词重合率：query 检索单元在文档中的覆盖率 */
// function keywordScore(query: string, text: string): number {
//   const qTokens = new Set(tokenizeText(query));
//   const docTokens = new Set(tokenizeText(text));
//   if (qTokens.size === 0) return 0;
//   let hit = 0;
//   for (const t of qTokens) if (docTokens.has(t)) hit++;
//   return hit / qTokens.size;
// }
// 
// /** 混合检索 */
// export async function searchKnowledge(
//   query: string,
//   options: RagSearchOptions = {}
// ): Promise<RagSearchResult> {
//   const { kind, subject, topK = 4, minScore = 0.05 } = options;
//   const index = await getIndex();
// 
//   const queryVector = index.usedEmbedding
//     ? (await embedTexts([query])).vectors[0]
//     : hashEmbed(query);
// 
//   const scored: RagHit[] = [];
//   for (const item of index.vectors) {
//     const chunk = index.chunks.find((c) => c.id === item.chunkId);
//     if (!chunk) continue;
//     if (kind && chunk.kind !== kind) continue;
//     if (subject && chunk.subject !== subject) continue;
// 
//     const vs = cosineSimilarity(queryVector, item.vector);
//     const ks = keywordScore(
//       query,
//       `${chunk.title}。${chunk.content}。${chunk.tags.join("，")}`
//     );
//     const score = VECTOR_WEIGHT * vs + KEYWORD_WEIGHT * ks;
//     if (score < minScore) continue;
//     scored.push({ chunk, vectorScore: vs, keywordScore: ks, score });
//   }
// 
//   scored.sort((a, b) => b.score - a.score);
//   const hits = scored.slice(0, topK);
//   return {
//     hits,
//     usedEmbedding: index.usedEmbedding,
//     embeddingModel: index.embeddingModel,
//   };
// }
// 
// /** 检索全部类型（不限定 kind），供工具 find_similar_problems 使用 */
// export async function searchAll(
//   query: string,
//   options: RagSearchOptions = {}
// ): Promise<RagSearchResult> {
//   return searchKnowledge(query, options);
// }
// 
// /** 生成命中摘要（供工具结果回填模型上下文） */
// export function formatHits(result: RagSearchResult, limit = 3): string {
//   if (result.hits.length === 0) return "（知识库未检索到相关内容）";
//   return result.hits
//     .slice(0, limit)
//     .map(
//       (h, i) =>
//         `【${i + 1}】${h.chunk.title}（${h.chunk.subject}/${h.chunk.kind}）\n${h.chunk.content.slice(0, 600)}`
//     )
//     .join("\n\n");
// }
// 
// /** 列出知识库覆盖的学科 */
// export async function listSubjects(): Promise<string[]> {
//   const index = await getIndex();
//   return [...new Set(index.chunks.map((c) => c.subject))];
// }
// 
