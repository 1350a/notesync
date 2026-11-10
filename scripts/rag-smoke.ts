/**
 * RAG 检索纯函数冒烟：分词/关键词覆盖/余弦/混合评分/切块/排序过滤。
 * 零依赖直跑：npm run smoke:rag（与既有 smoke:* 同款，--experimental-strip-types）
 */
import {
  chunkText,
  cosineSimilarity,
  hybridScore,
  keywordScore,
  rankChunks,
  tokenizeText,
} from '../lib/local/rag/search.ts';
import { SEED_KNOWLEDGE } from '../lib/local/rag/seed.ts';
import type { KnowledgeChunk } from '../lib/local/rag/types.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean) {
  if (cond) {
    passed += 1;
  } else {
    failures.push(name);
  }
}

/* ---------- tokenizeText：中文 unigram + bigram ---------- */
check('分词含 unigram 与 bigram', eq(tokenizeText('二次函数'), ['二', '次', '函', '数', '二次', '次函', '函数']));
check('分词跨标点取相邻字符', eq(tokenizeText('a，b c'), ['a', 'b', 'c', 'ab', 'bc']));
check('纯标点分词为空', tokenizeText('。！？').length === 0);

function eq(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/* ---------- keywordScore ---------- */
check('全覆盖=1', keywordScore('二次函数', '二次函数的图像') === 1);
check('零覆盖=0', keywordScore('圆心切线', '二次函数的图像') === 0);
check('部分覆盖介于 0 和 1', keywordScore('二次函数数列', '二次函数的图像') > 0 && keywordScore('二次函数数列', '二次函数的图像') < 1);
check('空 query=0', keywordScore('。', '任意文本') === 0);

/* ---------- cosineSimilarity ---------- */
check('同向归一化向量=1', Math.abs(cosineSimilarity([0.6, 0.8], [0.6, 0.8]) - 1) < 1e-9);
check('正交向量=0', cosineSimilarity([1, 0], [0, 1]) === 0);
check('反向钳制到 0', cosineSimilarity([1, 0], [-1, 0]) === 0);
check('非归一化按模长修正', Math.abs(cosineSimilarity([3, 0], [0, 5]) - 0) < 1e-9);
check('零向量=0', cosineSimilarity([0, 0], [1, 1]) === 0);
check('Float32Array 与 number[] 混算', Math.abs(cosineSimilarity(Float32Array.from([1, 1]), [1, 1]) - 1) < 1e-6);

/* ---------- hybridScore 权重 ---------- */
check('混合评分权重 0.65/0.35', Math.abs(hybridScore(1, 0) - 0.65) < 1e-9 && Math.abs(hybridScore(0, 1) - 0.35) < 1e-9);

/* ---------- chunkText ---------- */
check('按空行分段', eq(chunkText('第一段\n\n第二段'), ['第一段', '第二段']));
check('超长段按句边界切且不超上限', (() => {
  const long = '一句话。'.repeat(300); // 1200 字符单段
  const chunks = chunkText(long, 500);
  return chunks.length > 1 && chunks.every((c) => c.length <= 500);
})());
check('短文本原样成块', eq(chunkText('单段短文本'), ['单段短文本']));

/* ---------- rankChunks：排序/过滤/阈值 ---------- */
const chunks: KnowledgeChunk[] = [
  { id: 'a', title: '二次函数', kind: 'knowledge', subject: '数学', content: '抛物线', tags: [] },
  { id: 'b', title: '错题案例', kind: 'mistake', subject: '数学', content: '去括号符号', tags: [] },
  { id: 'c', title: '应用指南', kind: 'knowledge', subject: '应用指南', content: '本应用是什么', tags: [] },
];
// 人造向量：a 与 query 同向，b 半相关，c 正交
const vecA = [1, 0, 0];
const vecB = [0.5, 0.5, 0];
const vecC = [0, 0, 1];
const vecQ = [1, 0, 0];
const vectors = [vecA, vecB, vecC];

check('按综合分降序', rankChunks(Float32Array.from(vecQ), '二次函数', chunks, vectors)[0].chunk.id === 'a');
check('topK 生效', rankChunks(Float32Array.from(vecQ), '二次函数', chunks, vectors, { topK: 2 }).length === 2);
check('kind 过滤', rankChunks(Float32Array.from(vecQ), '二次函数', chunks, vectors, { kind: 'mistake' }).every((h) => h.chunk.kind === 'mistake'));
check('subject 过滤', rankChunks(Float32Array.from(vecQ), '应用', chunks, vectors, { subject: '应用指南' }).every((h) => h.chunk.subject === '应用指南'));
check('minScore 阈值截断', rankChunks(Float32Array.from(vecQ), '二次函数', chunks, vectors, { minScore: 0.9 }).every((h) => h.score >= 0.9));
check('命中携带向量分与关键词分', (() => {
  const hit = rankChunks(Float32Array.from(vecQ), '二次函数', chunks, vectors)[0];
  return hit.vectorScore === 1 && hit.keywordScore > 0;
})());

/* ---------- 种子语料健全性 ---------- */
check('种子卡 ID 无重复', new Set(SEED_KNOWLEDGE.map((c) => c.id)).size === SEED_KNOWLEDGE.length);
check('种子卡字段齐全', SEED_KNOWLEDGE.every((c) => c.title && c.content && c.tags.length > 0));

/* ---------- 汇总 ---------- */
console.log(`[smoke:rag] 通过 ${passed} 项${failures.length > 0 ? `，失败 ${failures.length} 项` : ''}`);
if (failures.length > 0) {
  for (const name of failures) console.error(`  ✗ ${name}`);
  process.exit(1);
}
