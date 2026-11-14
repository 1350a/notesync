import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearTraces,
  finalizeTrace,
  loadTraces,
  TRACE_INDEX_KEY,
  TRACE_KEEP,
  TRACE_LEGACY_KEY,
  TRACE_MAX_CHARS,
  TRACE_SHARD_PREFIX,
  type Trace,
} from '../../../lib/chat/trace.ts';

/*
 * trace 存储 v2（索引键 + 按条分片）：node 环境没有 window，用内存假实现注入。
 * 固化四件事：
 * 1) 单条超 TRACE_MAX_CHARS 只截自己这条的 events 尾部并打 truncated；
 * 2) 超 TRACE_KEEP 淘汰最旧分片（分片键一并删除，不是只挪索引）；
 * 3) v1 单键在首次读取时一次性迁移到 v2，迁移后删源键且不重复搬；
 * 4) 坏片（JSON 损坏 / 形状不对 / 分片缺失）单独跳过，不牵连其它记录。
 */

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  /** 分片键列表（索引键同前缀，需排除） */
  shardKeys(): string[] {
    return this.keys().filter(
      (key) => key.startsWith(TRACE_SHARD_PREFIX) && key !== TRACE_INDEX_KEY,
    );
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

/** 造一条 trace：startedAt 按序号递增，事件体可控大小 */
function makeTrace(seq: number, eventCount = 2, payloadSize = 10): Trace {
  return {
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    route: 'chat',
    model: 'deepseek-chat',
    events: Array.from({ length: eventCount }, (_, index) => ({
      ms: index,
      event: 'delta',
      data: { text: 'x'.repeat(payloadSize) },
    })),
  };
}

function readIndex(): Array<{ id: string; startedAt: string; route: string; size: number; truncated?: boolean }> {
  const raw = storage.getItem(TRACE_INDEX_KEY);
  return raw ? (JSON.parse(raw) as Array<{ id: string; startedAt: string; route: string; size: number; truncated?: boolean }>) : [];
}

describe('trace 存储 v2（分片）', () => {
  it('单条超限：只截本条 events 尾部并打 truncated 标记', () => {
    const huge = makeTrace(0, 400, 1000);
    finalizeTrace(huge);

    const [loaded] = loadTraces();
    expect(loaded).toBeDefined();
    expect(loaded.truncated).toBe(true);
    expect(loaded.eventsDropped).toBeGreaterThan(0);
    expect(loaded.events.length).toBe(400 - (loaded.eventsDropped as number));
    expect(loaded.events.length).toBeLessThan(400);
    // 保留头部事件、丢尾部
    expect(loaded.events[0].ms).toBe(0);

    const [entry] = readIndex();
    expect(entry.truncated).toBe(true);
    expect(entry.size).toBeLessThanOrEqual(TRACE_MAX_CHARS);
    const shard = storage.getItem(`${TRACE_SHARD_PREFIX}${entry.id}`) ?? '';
    expect(shard.length).toBeLessThanOrEqual(TRACE_MAX_CHARS);
  });

  it('超 TRACE_KEEP 淘汰最旧分片，不只挪索引', () => {
    const total = TRACE_KEEP + 3;
    for (let seq = 0; seq < total; seq += 1) finalizeTrace(makeTrace(seq));

    const loaded = loadTraces();
    expect(loaded).toHaveLength(TRACE_KEEP);
    expect(loaded[0].startedAt).toBe(makeTrace(3).startedAt);
    expect(loaded[TRACE_KEEP - 1].startedAt).toBe(makeTrace(total - 1).startedAt);
    // 索引条数与分片键数一致，且最旧的分片确实被删掉
    expect(readIndex()).toHaveLength(TRACE_KEEP);
    expect(storage.shardKeys()).toHaveLength(TRACE_KEEP);
  });

  it('v1 单键首次读取时一次性迁移到 v2，并删除源键', () => {
    const legacy = [makeTrace(0), makeTrace(1)];
    storage.setItem(TRACE_LEGACY_KEY, JSON.stringify(legacy));

    const migrated = loadTraces();
    expect(migrated.map((trace) => trace.startedAt)).toEqual(
      legacy.map((trace) => trace.startedAt),
    );
    expect(storage.getItem(TRACE_LEGACY_KEY)).toBeNull();
    expect(readIndex()).toHaveLength(2);
    expect(storage.shardKeys()).toHaveLength(2);

    // 迁移只做一次：再次读取不会重复搬
    expect(loadTraces()).toHaveLength(2);
    expect(storage.shardKeys()).toHaveLength(2);
  });

  it('坏片跳过，不整库丢弃', () => {
    finalizeTrace(makeTrace(0));
    finalizeTrace(makeTrace(1));
    finalizeTrace(makeTrace(2));

    const index = readIndex();
    // 中间那条损坏成非法 JSON，最后一条分片直接缺失
    storage.setItem(`${TRACE_SHARD_PREFIX}${index[1].id}`, '{not-json');
    storage.removeItem(`${TRACE_SHARD_PREFIX}${index[2].id}`);

    const loaded = loadTraces();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].startedAt).toBe(makeTrace(0).startedAt);
  });

  it('索引键只存元数据，不含事件体', () => {
    finalizeTrace(makeTrace(0, 3, 64));

    const rawIndex = storage.getItem(TRACE_INDEX_KEY) ?? '';
    expect(rawIndex).not.toContain('events');
    expect(rawIndex).not.toContain('delta');
    expect(rawIndex).not.toContain('x'.repeat(64));

    const [entry] = readIndex();
    expect(entry.route).toBe('chat');
    expect(typeof entry.size).toBe('number');
    expect(entry.size).toBeGreaterThan(0);
  });

  it('clearTraces 连分片带索引一起清空', () => {
    finalizeTrace(makeTrace(0));
    finalizeTrace(makeTrace(1));
    storage.setItem(TRACE_LEGACY_KEY, JSON.stringify([makeTrace(2)]));

    clearTraces();
    expect(loadTraces()).toEqual([]);
    expect(storage.getItem(TRACE_INDEX_KEY)).toBeNull();
    expect(storage.shardKeys()).toHaveLength(0);
    expect(storage.getItem(TRACE_LEGACY_KEY)).toBeNull();
  });
});
