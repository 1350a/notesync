/*
 * =====================================================================
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：lib\rag\types.ts
 * 说明：简易重构后无活跃引用、不再参与编译链路；此处逐行注释保留原文。
 * 恢复：git checkout -- lib/rag/types.ts（如已提交），或删除各行前缀 "// "。
 * =====================================================================
 */
// /**
//  * RAG 知识库 - 共享类型定义
//  *
//  * 知识库为 Agent 提供两类可检索素材：
//  * - knowledge：知识点卡片（概念、公式、易错点）
//  * - mistake：典型错题案例（错因分类、诊断模板）
//  */
// 
// /** 知识块类型 */
// export type KnowledgeKind = "knowledge" | "mistake";
// 
// /** 知识库文档块 */
// export interface KnowledgeChunk {
//   id: string;
//   /** 标题（知识点名或错题标题） */
//   title: string;
//   kind: KnowledgeKind;
//   /** 学科 */
//   subject: string;
//   /** 正文（概念、公式、错因分析等） */
//   content: string;
//   /** 标签（用于关键词检索加权） */
//   tags: string[];
//   /** 来源说明 */
//   source?: string;
// }
// 
// /** 向量索引项 */
// export interface VectorItem {
//   chunkId: string;
//   vector: number[];
// }
// 
// /** 检索命中的知识块 */
// export interface RagHit {
//   chunk: KnowledgeChunk;
//   /** 向量相似度（余弦，0-1） */
//   vectorScore: number;
//   /** 关键词重合率（0-1） */
//   keywordScore: number;
//   /** 综合分数（0-1） */
//   score: number;
// }
// 
// /** 检索结果 */
// export interface RagSearchResult {
//   hits: RagHit[];
//   /** 是否真正使用了嵌入模型（false=仅本地哈希向量兜底） */
//   usedEmbedding: boolean;
//   /** 嵌入模型名（用于展示） */
//   embeddingModel: string;
// }
// 
// /** 检索选项 */
// export interface RagSearchOptions {
//   /** 限定知识块类型 */
//   kind?: KnowledgeKind;
//   /** 限定学科 */
//   subject?: string;
//   /** 返回条数上限 */
//   topK?: number;
//   /** 综合分阈值（低于则视为未命中） */
//   minScore?: number;
// }
// 
