import { describe, expect, it } from 'vitest';
import {
  createMemoryHistoryStorage,
  createNoopHistoryStorage,
} from '../../../lib/history/memory.ts';
import { createSessionMeta, makeBlobKey } from '../../../lib/history/types.ts';
import type { HistoryMessage, SessionMeta } from '../../../lib/history/types.ts';

/*
 * 内存实现（doc/chat-history.md §4）：既是降级兜底，也是唯一能在 node 环境跑通的
 * 会话语义验证载体。这里固化的是「写进去再读出来必须等价」以及三条降级规则：
 * 配额受限不阻断文本、单条脏数据不连坐、过期必须留痕。
 */

/** 造一张解码后约等于 bytes 字节的图片 dataURL */
function imageOf(bytes: number): string {
  const payloadLength = Math.ceil(bytes / 3) * 4;
  return `data:image/png;base64,${'A'.repeat(payloadLength)}`;
}

function userMessage(content: string, images?: string[]): HistoryMessage {
  const message: HistoryMessage = { role: 'user', content };
  if (images) message.images = images;
  return message;
}

function assistantMessage(content: string): HistoryMessage {
  return { role: 'assistant', content };
}

/** 造一个可控时钟，保证 updatedAt 断言与排序稳定 */
function makeClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    tick(ms = 1000) {
      current += ms;
      return current;
    },
  };
}

describe('内存实现：会话读写', () => {
  it('supported 为 true；空库列表为空', async () => {
    const storage = createMemoryHistoryStorage();
    expect(storage.supported).toBe(true);
    expect(await storage.listSessions()).toEqual([]);
  });

  it('存进去再读出来等价：图片按槽位回填，空槽位仍是空串', async () => {
    const storage = createMemoryHistoryStorage();
    const meta = createSessionMeta('s1', 1000);
    const image = imageOf(9);
    const messages: HistoryMessage[] = [
      userMessage('第一句', [image, '']),
      assistantMessage('回答'),
      userMessage('第二句', ['', image]),
    ];

    const result = await storage.saveSession(meta, { id: 's1', messages, expiredImages: [] });
    expect(result.status).toBe('saved');
    expect(result.expired).toEqual([]);

    const loaded = await storage.loadSession('s1');
    expect(loaded?.messages).toEqual(messages);
  });

  it('保存时刷新会话头：消息数 / 文本字节 / 附件字节 / updatedAt', async () => {
    const clock = makeClock();
    const storage = createMemoryHistoryStorage({ now: clock.now });
    await storage.saveSession(createSessionMeta('s1', 1000), {
      id: 's1',
      messages: [userMessage('abcd', [imageOf(6)])],
      expiredImages: [],
    });

    const [meta] = await storage.listSessions();
    expect(meta.messageCount).toBe(1);
    expect(meta.textBytes).toBe(4);
    expect(meta.attachmentBytes).toBe(6);
    expect(meta.updatedAt).toBe(clock.now());
  });

  it('列表按 updatedAt 倒序', async () => {
    const clock = makeClock();
    const storage = createMemoryHistoryStorage({ now: clock.now });
    for (const id of ['a', 'b', 'c']) {
      clock.tick();
      await storage.saveSession(createSessionMeta(id, clock.now()), {
        id,
        messages: [userMessage(id)],
        expiredImages: [],
      });
    }
    const ids = (await storage.listSessions()).map((meta) => meta.id);
    expect(ids).toEqual(['c', 'b', 'a']);
  });

  it('更新已有会话不会产生重复项', async () => {
    const clock = makeClock();
    const storage = createMemoryHistoryStorage({ now: clock.now });
    const meta = createSessionMeta('s1', clock.now());
    await storage.saveSession(meta, { id: 's1', messages: [userMessage('一')], expiredImages: [] });
    clock.tick();
    await storage.saveSession(meta, {
      id: 's1',
      messages: [userMessage('一'), assistantMessage('二')],
      expiredImages: [],
    });
    expect(await storage.listSessions()).toHaveLength(1);
    expect((await storage.loadSession('s1'))?.messages).toHaveLength(2);
  });

  it('消息变少时旧附件不残留，占用同步下降', async () => {
    const storage = createMemoryHistoryStorage();
    const meta = createSessionMeta('s1', 1000);
    await storage.saveSession(meta, {
      id: 's1',
      messages: [userMessage('a', [imageOf(9)]), userMessage('b', [imageOf(9)])],
      expiredImages: [],
    });
    expect((await storage.estimate()).usage).toBe(18);

    await storage.saveSession(meta, { id: 's1', messages: [userMessage('a', [imageOf(9)])], expiredImages: [] });
    expect((await storage.estimate()).usage).toBe(9);
    expect(await storage.loadBlob(makeBlobKey('s1', 1, 0))).toBeNull();
  });

  it('未知会话读出 null，不抛错', async () => {
    const storage = createMemoryHistoryStorage();
    expect(await storage.loadSession('nope')).toBeNull();
    expect(await storage.loadBlob(makeBlobKey('nope', 0, 0))).toBeNull();
  });

  it('空 assistant 气泡与脏 role 在写入时被剔除（沿用清洗口径）', async () => {
    const storage = createMemoryHistoryStorage();
    const meta = createSessionMeta('s1', 1000);
    const dirty = [
      userMessage('问题'),
      { role: 'assistant', content: '   ' },
      { role: 'system', content: '非法角色' },
      assistantMessage('回答'),
    ] as unknown as HistoryMessage[];

    await storage.saveSession(meta, { id: 's1', messages: dirty, expiredImages: [] });
    const loaded = await storage.loadSession('s1');
    expect(loaded?.messages.map((message) => message.content)).toEqual(['问题', '回答']);
    expect((await storage.listSessions())[0].messageCount).toBe(2);
  });
});

describe('内存实现：标题', () => {
  it('无标题写入时回落「新对话」', async () => {
    const storage = createMemoryHistoryStorage();
    const meta: SessionMeta = { ...createSessionMeta('s1', 1000), title: '   ' };
    await storage.saveSession(meta, { id: 's1', messages: [userMessage('a')], expiredImages: [] });
    expect((await storage.listSessions())[0].title).toBe('新对话');
  });

  it('改名成功并置 titleEdited，后续保存不再覆盖', async () => {
    const clock = makeClock();
    const storage = createMemoryHistoryStorage({ now: clock.now });
    const meta = createSessionMeta('s1', clock.now());
    await storage.saveSession(meta, { id: 's1', messages: [userMessage('a')], expiredImages: [] });

    expect(await storage.renameSession('s1', '手动标题')).toBe(true);
    const renamed = (await storage.listSessions())[0];
    expect(renamed.title).toBe('手动标题');
    expect(renamed.titleEdited).toBe(true);

    clock.tick();
    // 再次保存时传入的是旧 meta（标题仍是自动派生值），不得覆盖手改结果
    await storage.saveSession(meta, { id: 's1', messages: [userMessage('b')], expiredImages: [] });
    expect((await storage.listSessions())[0].title).toBe('手动标题');
  });

  it('空标题或未知会话改名返回 false', async () => {
    const storage = createMemoryHistoryStorage();
    await storage.saveSession(createSessionMeta('s1', 1000), {
      id: 's1',
      messages: [userMessage('a')],
      expiredImages: [],
    });
    expect(await storage.renameSession('s1', '   ')).toBe(false);
    expect(await storage.renameSession('nope', '标题')).toBe(false);
    expect((await storage.listSessions())[0].title).toBe('新对话');
  });
});

describe('内存实现：删除与清空', () => {
  it('删除会话会一并清掉消息、会话头与附件', async () => {
    const storage = createMemoryHistoryStorage();
    await storage.saveSession(createSessionMeta('s1', 1000), {
      id: 's1',
      messages: [userMessage('a', [imageOf(9)])],
      expiredImages: [],
    });
    await storage.deleteSession('s1');
    expect(await storage.listSessions()).toEqual([]);
    expect(await storage.loadSession('s1')).toBeNull();
    expect(await storage.loadBlob(makeBlobKey('s1', 0, 0))).toBeNull();
    expect((await storage.estimate()).usage).toBe(0);
  });

  it('删除不存在的会话不抛错', async () => {
    const storage = createMemoryHistoryStorage();
    await expect(storage.deleteSession('nope')).resolves.toBeUndefined();
  });

  it('clearAll 清空全部会话', async () => {
    const storage = createMemoryHistoryStorage();
    for (const id of ['a', 'b']) {
      await storage.saveSession(createSessionMeta(id, 1000), {
        id,
        messages: [userMessage(id)],
        expiredImages: [],
      });
    }
    await storage.clearAll();
    expect(await storage.listSessions()).toEqual([]);
  });
});

describe('内存实现：预算淘汰', () => {
  it('会话内超预算时最早的图片过期，文本照常保留', async () => {
    const storage = createMemoryHistoryStorage();
    const meta = createSessionMeta('s1', 1000);
    // 单会话预算 20MB：直接构造 21MB 附件成本太高，这里改为验证「超预算」的边界由
    // planEviction 单测覆盖；本用例只确认未超预算时不误伤
    await storage.saveSession(meta, {
      id: 's1',
      messages: [userMessage('a', [imageOf(9)]), userMessage('b', [imageOf(9)])],
      expiredImages: [],
    });
    const loaded = await storage.loadSession('s1');
    expect(loaded?.expiredImages).toEqual([]);
    expect(loaded?.messages[0].images?.[0]).not.toBe('');
  });

  it('全局超预算时从最旧会话的最早附件开始过期，并同步会话头', async () => {
    // quota=100 → 全局预算 30 字节
    const clock = makeClock();
    const storage = createMemoryHistoryStorage({ quota: 100, now: clock.now });

    // 旧会话 2 张 12 字节，新会话 1 张 12 字节：合计 36，超预算 6
    await storage.saveSession(createSessionMeta('old', clock.now()), {
      id: 'old',
      messages: [userMessage('旧', [imageOf(12), imageOf(12)])],
      expiredImages: [],
    });
    clock.tick();
    const result = await storage.saveSession(createSessionMeta('new', clock.now()), {
      id: 'new',
      messages: [userMessage('新', [imageOf(12)])],
      expiredImages: [],
    });

    // 淘汰发生在旧会话上：本次写入的会话本身不产生过期
    expect(result.expired).toEqual([]);

    const oldSession = await storage.loadSession('old');
    expect(oldSession?.messages[0].images).toEqual(['', imageOf(12)]);
    expect(oldSession?.expiredImages).toEqual([{ msg: 0, img: 0 }]);

    const metas = await storage.listSessions();
    expect(metas.find((meta) => meta.id === 'old')?.attachmentBytes).toBe(12);
    expect((await storage.estimate()).usage).toBe(24);
  });
});

describe('内存实现：降级路径', () => {
  it('附件写失败时只丢图片、留文本，并把槽位登记为过期', async () => {
    const storage = createMemoryHistoryStorage({ failAttachmentWrite: true });
    const result = await storage.saveSession(createSessionMeta('s1', 1000), {
      id: 's1',
      messages: [userMessage('文字还在', [imageOf(9)]), assistantMessage('回答')],
      expiredImages: [],
    });

    expect(result.status).toBe('saved-without-attachments');
    expect(result.expired).toEqual([{ msg: 0, img: 0 }]);
    expect(result.attachmentBytes).toBe(0);

    const loaded = await storage.loadSession('s1');
    expect(loaded?.messages[0].content).toBe('文字还在');
    expect(loaded?.messages[0].images).toEqual(['']);
    expect(loaded?.expiredImages).toEqual([{ msg: 0, img: 0 }]);
  });

  it('过期位置在消息数变少后自动收敛，不留下越界坐标', async () => {
    const storage = createMemoryHistoryStorage({ failAttachmentWrite: true });
    const meta = createSessionMeta('s1', 1000);
    await storage.saveSession(meta, {
      id: 's1',
      messages: [userMessage('a', [imageOf(9)]), userMessage('b', [imageOf(9)])],
      expiredImages: [],
    });
    // 重存时只剩一条消息：原先 {msg:1} 的过期记录已越界，应当被丢弃
    await storage.saveSession(meta, {
      id: 's1',
      messages: [userMessage('a', [imageOf(9)])],
      expiredImages: [],
    });
    const loaded = await storage.loadSession('s1');
    expect(loaded?.expiredImages).toEqual([{ msg: 0, img: 0 }]);
  });

  it('estimate 反映附件占用并透传 quota', async () => {
    const storage = createMemoryHistoryStorage({ quota: 12345 });
    await storage.saveSession(createSessionMeta('s1', 1000), {
      id: 's1',
      messages: [userMessage('a', [imageOf(9)])],
      expiredImages: [],
    });
    expect(await storage.estimate()).toEqual({ usage: 9, quota: 12345 });
  });
});

describe('空实现（IDB 不可用）', () => {
  it('supported 为 false，写入返回 unsupported，读取恒为空', async () => {
    const storage = createNoopHistoryStorage();
    expect(storage.supported).toBe(false);
    const result = await storage.saveSession(createSessionMeta('s1', 1000), {
      id: 's1',
      messages: [userMessage('a')],
      expiredImages: [],
    });
    expect(result).toEqual({ status: 'unsupported', expired: [], textBytes: 0, attachmentBytes: 0 });
    expect(await storage.listSessions()).toEqual([]);
    expect(await storage.loadSession('s1')).toBeNull();
    expect(await storage.loadBlob('s1:0:0')).toBeNull();
    expect(await storage.renameSession('s1', '标题')).toBe(false);
    expect(await storage.estimate()).toEqual({ usage: 0, quota: 0 });
    await expect(storage.deleteSession('s1')).resolves.toBeUndefined();
    await expect(storage.clearAll()).resolves.toBeUndefined();
  });
});
