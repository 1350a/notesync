import { afterEach, describe, expect, it } from 'vitest';
import {
  ensurePersistentStorage,
  getHistoryStorage,
  isHistorySupported,
  resetHistoryStorageForTest,
} from '../../../lib/history/storage.ts';

/*
 * 存储工厂（doc/chat-history.md §2.5、§4）：node 环境没有 indexedDB，
 * 正是"浏览器不可用"的降级分支——这里固化两件事：
 * 1) 探测失败必须落到 supported === false 的空实现，而不是抛错或返回 null；
 * 2) 实例必须单例（store / hooks / 设置页共用同一条连接）。
 */

afterEach(() => {
  resetHistoryStorageForTest();
});

describe('history storage 工厂', () => {
  it('node 环境无 indexedDB 时降级为空实现', () => {
    const storage = getHistoryStorage();
    expect(storage.supported).toBe(false);
    expect(isHistorySupported()).toBe(false);
  });

  it('多次调用复用同一实例', () => {
    expect(getHistoryStorage()).toBe(getHistoryStorage());
  });

  it('重置后重新探测，得到新实例', () => {
    const first = getHistoryStorage();
    resetHistoryStorageForTest();
    const second = getHistoryStorage();
    expect(second).not.toBe(first);
    expect(second.supported).toBe(false);
  });

  it('降级环境下申请持久化不抛错', () => {
    expect(() => ensurePersistentStorage()).not.toThrow();
  });

  it('降级实现的所有读写都以空值表达，不抛错', async () => {
    const storage = getHistoryStorage();
    await expect(storage.listSessions()).resolves.toEqual([]);
    await expect(storage.loadSession('any')).resolves.toBeNull();
    await expect(storage.loadBlob('any:0:0')).resolves.toBeNull();
    await expect(storage.deleteSession('any')).resolves.toBeUndefined();
    await expect(storage.clearAll()).resolves.toBeUndefined();
  });
});
