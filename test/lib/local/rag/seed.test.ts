/*
 * lib/local/rag/seed.ts 种子语料完整性用例
 *
 * 迁移自 scripts/rag-smoke.ts 的种子语料断言。种子数据直接决定离线可用的
 * 知识库内容，一旦 id 撞车或字段缺失，检索侧会在无提示的情况下丢卡。
 */
import { describe, expect, it } from 'vitest';
import { SEED_KNOWLEDGE } from '@/lib/local/rag/seed';

describe('SEED_KNOWLEDGE', () => {
  it('非空', () => {
    expect(SEED_KNOWLEDGE.length).toBeGreaterThan(0);
  });

  it('id 无重复', () => {
    const ids = SEED_KNOWLEDGE.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每张卡字段齐全', () => {
    for (const chunk of SEED_KNOWLEDGE) {
      expect(chunk.id.length).toBeGreaterThan(0);
      expect(chunk.title.length).toBeGreaterThan(0);
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.tags.length).toBeGreaterThan(0);
      expect(chunk.subject.length).toBeGreaterThan(0);
    }
  });

  it('kind 只能是 knowledge 或 mistake', () => {
    for (const chunk of SEED_KNOWLEDGE) {
      expect(['knowledge', 'mistake']).toContain(chunk.kind);
    }
  });

  it('tags 无空串', () => {
    for (const chunk of SEED_KNOWLEDGE) {
      for (const tag of chunk.tags) expect(tag.trim().length).toBeGreaterThan(0);
    }
  });
});
