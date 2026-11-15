/*
 * lib/local/rag/search.ts 纯函数用例
 *
 * 迁移自 scripts/rag-smoke.ts 的 25 项断言（冒烟脚本保留，作为不依赖测试框架的
 * 兜底直跑入口），并补充 topK 纯函数边界、默认 topK / minScore、权重常量等覆盖。
 * 全部为纯函数断言：无 IO、无 Worker、无浏览器 API，node 环境直跑。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_SCORE,
  DEFAULT_TOP_K,
  KEYWORD_WEIGHT,
  VECTOR_WEIGHT,
  chunkText,
  cosineSimilarity,
  hybridScore,
  keywordScore,
  rankChunks,
  tokenizeText,
  topK,
} from '@/lib/local/rag/search';
import type { KnowledgeChunk } from '@/lib/local/rag/types';

/** 浮点比较容差：余弦与权重计算存在 IEEE754 误差 */
const EPS = 1e-9;

describe('tokenizeText', () => {
  it('产出中文 unigram 与 bigram', () => {
    expect(tokenizeText('二次函数')).toEqual([
      '二',
      '次',
      '函',
      '数',
      '二次',
      '次函',
      '函数',
    ]);
  });

  it('跨标点取相邻字符（标点本身不入 token）', () => {
    expect(tokenizeText('a，b c')).toEqual(['a', 'b', 'c', 'ab', 'bc']);
  });

  it('纯标点分词为空', () => {
    expect(tokenizeText('。！？')).toHaveLength(0);
  });

  it('大小写归一后再分词', () => {
    expect(tokenizeText('AB')).toEqual(['a', 'b', 'ab']);
  });
});

describe('keywordScore', () => {
  it('全覆盖等于 1', () => {
    expect(keywordScore('二次函数', '二次函数的图像')).toBe(1);
  });

  it('零覆盖等于 0', () => {
    expect(keywordScore('圆心切线', '二次函数的图像')).toBe(0);
  });

  it('部分覆盖介于 0 和 1 之间', () => {
    const score = keywordScore('二次函数数列', '二次函数的图像');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('空 query（纯标点）等于 0', () => {
    expect(keywordScore('。', '任意文本')).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('同向归一化向量等于 1', () => {
    expect(Math.abs(cosineSimilarity([0.6, 0.8], [0.6, 0.8]) - 1)).toBeLessThan(EPS);
  });

  it('正交向量等于 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('反向向量钳制到 0（不允许负分）', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });

  it('非归一化输入按模长修正', () => {
    // 同向不同模长 → 1；正交不同模长 → 0
    expect(Math.abs(cosineSimilarity([3, 0], [7, 0]) - 1)).toBeLessThan(EPS);
    expect(Math.abs(cosineSimilarity([3, 0], [0, 5]))).toBeLessThan(EPS);
  });

  it('零向量等于 0（分母为 0 不产生 NaN）', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  it('Float32Array 与 number[] 可混算', () => {
    expect(
      Math.abs(cosineSimilarity(Float32Array.from([1, 1]), [1, 1]) - 1),
    ).toBeLessThan(1e-6);
  });

  it('长度不一致时按较短长度截断计算', () => {
    expect(Math.abs(cosineSimilarity([1, 0, 9], [1, 0]) - 1)).toBeLessThan(EPS);
  });
});

describe('hybridScore 与权重常量', () => {
  it('权重为 0.65 余弦 + 0.35 关键词', () => {
    expect(VECTOR_WEIGHT).toBe(0.65);
    expect(KEYWORD_WEIGHT).toBe(0.35);
    expect(Math.abs(hybridScore(1, 0) - 0.65)).toBeLessThan(EPS);
    expect(Math.abs(hybridScore(0, 1) - 0.35)).toBeLessThan(EPS);
  });

  it('两侧满分时综合分为 1', () => {
    expect(Math.abs(hybridScore(1, 1) - 1)).toBeLessThan(EPS);
  });

  it('按权重线性融合中间值', () => {
    expect(Math.abs(hybridScore(0.8, 0.5) - (0.65 * 0.8 + 0.35 * 0.5))).toBeLessThan(
      EPS,
    );
  });
});

describe('chunkText', () => {
  it('按空行分段', () => {
    expect(chunkText('第一段\n\n第二段')).toEqual(['第一段', '第二段']);
  });

  it('超长段按句边界切分且每块不超上限', () => {
    const long = '一句话。'.repeat(300); // 1200 字符单段
    const chunks = chunkText(long, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
  });

  it('短文本原样成块', () => {
    expect(chunkText('单段短文本')).toEqual(['单段短文本']);
  });

  it('空文本切成空数组', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });
});

describe('topK', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('截断为前 k 条', () => {
    expect(topK(items, 2)).toEqual(['a', 'b']);
  });

  it('k 小于等于 0 返回空数组', () => {
    expect(topK(items, 0)).toEqual([]);
    expect(topK(items, -3)).toEqual([]);
  });

  it('k 非有限数返回空数组', () => {
    expect(topK(items, Number.NaN)).toEqual([]);
    expect(topK(items, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('k 超过长度时返回全部', () => {
    expect(topK(items, 99)).toEqual(items);
  });

  it('空数组返回空数组', () => {
    expect(topK([], 3)).toEqual([]);
  });

  it('返回副本，不改变入参数组', () => {
    const source = ['a', 'b'];
    const sliced = topK(source, 1);
    expect(sliced).not.toBe(source);
    expect(source).toEqual(['a', 'b']);
  });
});

describe('rankChunks', () => {
  /** 人造语料：a 与 query 同向、b 半相关、c 正交 */
  const chunks: KnowledgeChunk[] = [
    { id: 'a', title: '二次函数', kind: 'knowledge', subject: '数学', content: '抛物线', tags: [] },
    { id: 'b', title: '错题案例', kind: 'mistake', subject: '数学', content: '去括号符号', tags: [] },
    { id: 'c', title: '应用指南', kind: 'knowledge', subject: '应用指南', content: '本应用是什么', tags: [] },
  ];
  // 语料向量按 rankChunks 签名用 Float32Array（与真实嵌入输出一致）
  const vecA = Float32Array.from([1, 0, 0]);
  const vecB = Float32Array.from([0.5, 0.5, 0]);
  const vecC = Float32Array.from([0, 0, 1]);
  const vecQ = Float32Array.from([1, 0, 0]);
  const vectors = [vecA, vecB, vecC];

  it('按综合分降序排列', () => {
    const hits = rankChunks(vecQ, '二次函数', chunks, vectors);
    expect(hits[0].chunk.id).toBe('a');
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it('综合分等于 0.65 向量分 + 0.35 关键词分', () => {
    for (const hit of rankChunks(vecQ, '二次函数', chunks, vectors)) {
      expect(
        Math.abs(hit.score - hybridScore(hit.vectorScore, hit.keywordScore)),
      ).toBeLessThan(EPS);
    }
  });

  it('命中携带向量分与关键词分', () => {
    const hit = rankChunks(vecQ, '二次函数', chunks, vectors)[0];
    expect(hit.vectorScore).toBe(1);
    expect(hit.keywordScore).toBeGreaterThan(0);
  });

  it('topK 生效', () => {
    expect(rankChunks(vecQ, '二次函数', chunks, vectors, { topK: 2 })).toHaveLength(2);
  });

  it('默认 topK 为 4 条', () => {
    expect(DEFAULT_TOP_K).toBe(4);
    const many: KnowledgeChunk[] = Array.from({ length: 6 }, (_, i) => ({
      id: `k${i}`,
      title: '二次函数',
      kind: 'knowledge',
      subject: '数学',
      content: '抛物线',
      tags: [],
    }));
    const hits = rankChunks(
      vecQ,
      '二次函数',
      many,
      many.map(() => vecA),
    );
    expect(hits).toHaveLength(4);
  });

  it('默认 minScore 为 0.05，零分命中被截断', () => {
    expect(DEFAULT_MIN_SCORE).toBe(0.05);
    // c 的向量正交且关键词零覆盖 → 综合分 0，低于默认阈值不入结果
    const ids = rankChunks(vecQ, '二次函数', chunks, vectors).map((h) => h.chunk.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('minScore 阈值截断', () => {
    const hits = rankChunks(vecQ, '二次函数', chunks, vectors, { minScore: 0.9 });
    for (const hit of hits) expect(hit.score).toBeGreaterThanOrEqual(0.9);
    expect(hits).toHaveLength(1);
  });

  it('kind 过滤只留指定类型', () => {
    const hits = rankChunks(vecQ, '二次函数', chunks, vectors, { kind: 'mistake' });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.chunk.kind).toBe('mistake');
  });

  it('subject 过滤只留指定学科', () => {
    const hits = rankChunks(vecQ, '应用', chunks, vectors, { subject: '应用指南' });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.chunk.subject).toBe('应用指南');
  });

  it('语料与向量条数不齐时跳过缺向量的块', () => {
    const hits = rankChunks(vecQ, '二次函数', chunks, [vecA]);
    expect(hits.map((h) => h.chunk.id)).toEqual(['a']);
  });

  it('空语料返回空结果', () => {
    expect(rankChunks(vecQ, '二次函数', [], [])).toEqual([]);
  });
});
