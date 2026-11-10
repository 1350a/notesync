/*
 * 浏览器端 RAG 共享类型（对齐旧服务端 lib/rag/types.ts 设计，见
 * doc/browser-local-inference.md §5；旧文件已注释停用仅作参考）。
 */

/** 知识块类型：知识点卡片 / 典型错题案例 */
export type KnowledgeKind = "knowledge" | "mistake";

/** 知识库文档块（种子卡一卡一块） */
export interface KnowledgeChunk {
  id: string;
  /** 标题（知识点名或错题标题） */
  title: string;
  kind: KnowledgeKind;
  /** 学科或主题（如 数学 / 应用指南） */
  subject: string;
  /** 正文（概念、公式、错因分析等） */
  content: string;
  /** 标签（用于关键词检索加权） */
  tags: string[];
  /** 来源说明 */
  source?: string;
}

/** 检索命中的知识块 */
export interface RagHit {
  chunk: KnowledgeChunk;
  /** 向量相似度（余弦，0~1） */
  vectorScore: number;
  /** 关键词重合率（0~1） */
  keywordScore: number;
  /** 综合分数（0~1） */
  score: number;
}

/** 检索选项 */
export interface RagSearchOptions {
  /** 限定知识块类型 */
  kind?: KnowledgeKind;
  /** 限定学科或主题 */
  subject?: string;
  /** 返回条数上限 */
  topK?: number;
  /** 综合分阈值（低于则视为未命中） */
  minScore?: number;
}
