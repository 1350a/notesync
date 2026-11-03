/*
 * =====================================================================
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：lib\rag\embedding.ts
 * 说明：简易重构后无活跃引用、不再参与编译链路；此处逐行注释保留原文。
 * 恢复：git checkout -- lib/rag/embedding.ts（如已提交），或删除各行前缀 "// "。
 * =====================================================================
 */
// /**
//  * RAG 知识库 - 嵌入服务
//  *
//  * 嵌入采用三级策略：
//  * 1. ollama 原生嵌入接口（/api/embed，新版；失败回退旧版 /api/embeddings）
//  * 2. 本地哈希词袋向量（零依赖兜底，中文按字符 unigram+bigram 哈希到固定维度）
//  *
//  * 这样即使没有外部模型服务，知识库检索依然可用（哈希向量虽粗糙但
//  * 对短文本检索足够），有 ollama 时自动升级为语义向量。
//  */
// 
// /** 本地哈希向量维度 */
// const HASH_DIM = 512;
// /** ollama 嵌入请求超时（ms） */
// const EMBED_TIMEOUT = 8000;
// /** 嵌入模型名（可通过环境变量覆盖） */
// const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
// /** ollama 服务地址 */
// const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
// 
// /** L2 归一化 */
// function normalizeL2(vec: number[]): number[] {
//   let sum = 0;
//   for (const v of vec) sum += v * v;
//   const norm = Math.sqrt(sum) || 1;
//   return vec.map((v) => v / norm);
// }
// 
// /** 从文本提取中文检索单元：字符 unigram + bigram（保留中文/字母/数字） */
// export function tokenizeText(text: string): string[] {
//   const chars: string[] = [];
//   for (const ch of text.toLowerCase()) {
//     if (/[\u4e00-\u9fa5a-z0-9]/.test(ch)) chars.push(ch);
//   }
//   const tokens = [...chars];
//   for (let i = 0; i < chars.length - 1; i++) {
//     tokens.push(chars[i] + chars[i + 1]);
//   }
//   return tokens;
// }
// 
// /** 本地哈希词袋向量（零依赖兜底嵌入） */
// export function hashEmbed(text: string): number[] {
//   const vec = new Array<number>(HASH_DIM).fill(0);
//   const counts = new Map<string, number>();
//   for (const t of tokenizeText(text)) {
//     counts.set(t, (counts.get(t) ?? 0) + 1);
//   }
//   for (const [token, count] of counts) {
//     let h = 0;
//     for (let i = 0; i < token.length; i++) {
//       h = (h * 31 + token.charCodeAt(i)) >>> 0;
//     }
//     vec[h % HASH_DIM] += count;
//   }
//   return normalizeL2(vec);
// }
// 
// /** 余弦相似度（已归一化向量可直接点乘） */
// export function cosineSimilarity(a: number[], b: number[]): number {
//   const len = Math.min(a.length, b.length);
//   let dot = 0;
//   for (let i = 0; i < len; i++) dot += a[i] * b[i];
//   return Math.max(0, Math.min(1, dot));
// }
// 
// /** 通过 ollama 获取向量；不可用时返回 null */
// async function ollamaEmbedBatch(texts: string[]): Promise<number[][] | null> {
//   if (texts.length === 0) return null;
//   const controller = new AbortController();
//   const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT);
//   try {
//     // 新版接口 /api/embed：批量输入
//     const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
//       signal: controller.signal,
//       cache: "no-store",
//     });
//     if (res.ok) {
//       const data = (await res.json()) as { embeddings?: number[][] };
//       if (Array.isArray(data.embeddings) && data.embeddings.length === texts.length) {
//         return data.embeddings.map((v) => normalizeL2(v));
//       }
//     }
//   } catch {
//     // 继续尝试旧版接口
//   } finally {
//     clearTimeout(timer);
//   }
// 
//   // 旧版接口 /api/embeddings：单条输入，逐条请求
//   const controller2 = new AbortController();
//   const timer2 = setTimeout(() => controller2.abort(), EMBED_TIMEOUT);
//   try {
//     const out: number[][] = [];
//     for (const text of texts) {
//       const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
//         signal: controller2.signal,
//         cache: "no-store",
//       });
//       if (!res.ok) return null;
//       const data = (await res.json()) as { embedding?: number[] };
//       if (!Array.isArray(data.embedding)) return null;
//       out.push(normalizeL2(data.embedding));
//     }
//     return out;
//   } catch {
//     return null;
//   } finally {
//     clearTimeout(timer2);
//   }
// }
// 
// /** 批量嵌入：优先 ollama，失败全部回退哈希向量 */
// export async function embedTexts(texts: string[]): Promise<{
//   vectors: number[][];
//   usedEmbedding: boolean;
//   model: string;
// }> {
//   const ollamaVectors = await ollamaEmbedBatch(texts);
//   if (ollamaVectors) {
//     return { vectors: ollamaVectors, usedEmbedding: true, model: EMBED_MODEL };
//   }
//   return {
//     vectors: texts.map((t) => hashEmbed(t)),
//     usedEmbedding: false,
//     model: "local-hash-v1",
//   };
// }
// 
