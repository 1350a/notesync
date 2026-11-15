import { describe, expect, it } from 'vitest';
import {
  applyEviction,
  collectAttachments,
  collectImageSlots,
  dataUrlBytes,
  fillImage,
  mergeExpiredRefs,
  messagesTextBytes,
  planEviction,
  planEvictionToFree,
  refreshMeta,
  resolveGlobalAttachmentBudget,
  resolveSessionAttachmentBudget,
  stripImageBodies,
  shiftExpiredRefsOnDelete,
  toExpiredRefs,
  totalAttachmentBytes,
  trimExpiredRefs,
  utf8Bytes,
} from '../../../lib/history/contract.ts';
import {
  GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES,
  SESSION_ATTACHMENT_BUDGET_BYTES,
  createSessionMeta,
  makeBlobKey,
} from '../../../lib/history/types.ts';
import type { AttachmentRef, ExpiredImageRef, HistoryMessage } from '../../../lib/history/types.ts';

/*
 * 容量契约（doc/chat-history.md §3）。
 *
 * 这些函数是 IDB 与内存两套实现的公共底座：淘汰算法一旦两侧理解不一致，
 * 就会出现"内存里测试通过、真实浏览器里图片凭空消失"。因此逐条固化口径：
 * 字节口径、收集顺序、淘汰顺序、预算回落。
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

function ref(sessionId: string, msgIndex: number, imgIndex: number, bytes: number): AttachmentRef {
  return {
    key: makeBlobKey(sessionId, msgIndex, imgIndex),
    sessionId,
    msgIndex,
    imgIndex,
    bytes,
  };
}

describe('字节口径', () => {
  it('utf8Bytes 按 UTF-8 计：ASCII 1 字节、中文 3 字节、emoji 4 字节', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('中文')).toBe(6);
    expect(utf8Bytes('😀')).toBe(4);
    expect(utf8Bytes('')).toBe(0);
  });

  it('utf8Bytes 与 TextEncoder 结果一致（含代理对混合串）', () => {
    const samples = ['a中😀b', '𠮷野家', '\u0000\uffff', 'x'.repeat(1000)];
    for (const sample of samples) {
      expect(utf8Bytes(sample)).toBe(new TextEncoder().encode(sample).length);
    }
  });

  it('dataUrlBytes 忽略头部只算 payload，空串为 0', () => {
    expect(dataUrlBytes('')).toBe(0);
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    // 无逗号的脏串：整体当 payload 处理，不抛错
    expect(dataUrlBytes('AAAA')).toBe(3);
  });

  it('messagesTextBytes 累加正文、思维链与文本文件', () => {
    const messages: HistoryMessage[] = [
      userMessage('abc'),
      {
        role: 'assistant',
        content: 'de',
        reasoning: 'xyz',
        files: [{ name: 'a.txt', text: '中' }],
      },
    ];
    expect(messagesTextBytes(messages)).toBe(3 + 2 + 3 + 3);
  });
});

describe('附件收集', () => {
  it('按 msgIndex、imgIndex 升序，空串槽位不计入', () => {
    const messages: HistoryMessage[] = [
      userMessage('a', [imageOf(3), '']),
      userMessage('b'),
      userMessage('c', ['', imageOf(6)]),
    ];
    const refs = collectAttachments('s1', messages);
    expect(refs.map((item) => [item.msgIndex, item.imgIndex])).toEqual([
      [0, 0],
      [2, 1],
    ]);
    expect(refs[0].key).toBe('s1:0:0');
    expect(refs[1].key).toBe('s1:2:1');
    expect(totalAttachmentBytes(refs)).toBe(9);
  });

  it('collectImageSlots 与 collectAttachments 的坐标一致（供落库拆分使用）', () => {
    const messages: HistoryMessage[] = [userMessage('a', ['', imageOf(3)])];
    expect(collectImageSlots('s1', messages)).toEqual([{ key: 's1:0:1', msgIndex: 0, imgIndex: 1 }]);
  });
});

describe('预算与淘汰', () => {
  it('resolveSessionAttachmentBudget 为 20MB 常量', () => {
    expect(resolveSessionAttachmentBudget()).toBe(SESSION_ATTACHMENT_BUDGET_BYTES);
  });

  it('resolveGlobalAttachmentBudget 取 min(硬上限, quota×0.3)，quota 缺失回落硬上限', () => {
    expect(resolveGlobalAttachmentBudget(undefined)).toBe(GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES);
    expect(resolveGlobalAttachmentBudget(0)).toBe(GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES);
    expect(resolveGlobalAttachmentBudget(Number.NaN)).toBe(GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES);
    // 10GB × 0.3 = 3GB > 300MB 上限
    expect(resolveGlobalAttachmentBudget(10 * 1024 * 1024 * 1024)).toBe(
      GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES
    );
    // 1GB × 0.3 = 307MB > 300MB 上限，仍取上限
    expect(resolveGlobalAttachmentBudget(1024 * 1024 * 1024)).toBe(
      GLOBAL_ATTACHMENT_BUDGET_CAP_BYTES
    );
    // 100MB × 0.3 = 30MB，低于上限取 30MB
    expect(resolveGlobalAttachmentBudget(100 * 1024 * 1024)).toBe(Math.floor(100 * 1024 * 1024 * 0.3));
  });

  it('未超预算不淘汰、恰好等于预算也不淘汰', () => {
    const items = [ref('s1', 0, 0, 10), ref('s1', 1, 0, 10)];
    expect(planEviction(items, 20)).toEqual([]);
    expect(planEviction(items, 21)).toEqual([]);
  });

  it('超预算从最旧附件开始淘汰，直到不超', () => {
    const items = [ref('s1', 0, 0, 10), ref('s1', 0, 1, 10), ref('s1', 1, 0, 10)];
    // 合计 30、预算 25：只需腾出 5，淘汰最旧的那一张
    expect(planEviction(items, 25)).toEqual([items[0]]);
    // 预算 15：需腾出 15，最早两张入列
    expect(planEviction(items, 15)).toEqual([items[0], items[1]]);
    // 预算 0 视为全部过期
    expect(planEviction(items, 0)).toEqual(items);
  });

  it('单张即超预算时该张也入列（它本就不该入库）', () => {
    const items = [ref('s1', 0, 0, 100)];
    expect(planEviction(items, 10)).toEqual([items[0]]);
  });

  it('planEvictionToFree 按需要腾出的字节数累计，need<=0 返回空', () => {
    const items = [ref('s1', 0, 0, 10), ref('s1', 0, 1, 10), ref('s1', 1, 0, 10)];
    expect(planEvictionToFree(items, 0)).toEqual([]);
    expect(planEvictionToFree(items, 5)).toHaveLength(1);
    expect(planEvictionToFree(items, 10)).toHaveLength(1);
    expect(planEvictionToFree(items, 11)).toHaveLength(2);
    expect(planEvictionToFree(items, 999)).toHaveLength(3);
  });
});

describe('过期落地', () => {
  it('applyEviction 只置空命中槽位，数组长度与其它消息引用不变', () => {
    const messages: HistoryMessage[] = [
      userMessage('a', [imageOf(3), imageOf(3)]),
      userMessage('b'),
    ];
    const next = applyEviction(messages, [ref('s1', 0, 0, 3)]);
    expect(next[0].images).toEqual(['', messages[0].images?.[1]]);
    expect(next[0].images).toHaveLength(2);
    // 未命中的消息保持原引用，避免无谓重渲染
    expect(next[1]).toBe(messages[1]);
    // 原数组不被就地改写
    expect(messages[0].images?.[0]).not.toBe('');
  });

  it('无淘汰项时原样返回同一数组', () => {
    const messages: HistoryMessage[] = [userMessage('a')];
    expect(applyEviction(messages, [])).toBe(messages);
  });

  it('toExpiredRefs 去重并按 (msg, img) 升序', () => {
    const refs = [ref('s1', 1, 0, 1), ref('s1', 0, 1, 1), ref('s1', 1, 0, 1)];
    expect(toExpiredRefs(refs)).toEqual([
      { msg: 0, img: 1 },
      { msg: 1, img: 0 },
    ]);
  });

  it('mergeExpiredRefs 合并去重且排序，不改写入参', () => {
    const existing = [{ msg: 2, img: 0 }];
    const added = [{ msg: 0, img: 0 }, { msg: 2, img: 0 }];
    expect(mergeExpiredRefs(existing, added)).toEqual([
      { msg: 0, img: 0 },
      { msg: 2, img: 0 },
    ]);
    expect(existing).toEqual([{ msg: 2, img: 0 }]);
  });
});

describe('落库形态与回填', () => {
  it('stripImageBodies 保位不压缩：每个槽位变空串，其余字段不变', () => {
    const messages: HistoryMessage[] = [userMessage('a', [imageOf(3), '']), userMessage('b')];
    const stripped = stripImageBodies(messages);
    expect(stripped[0].images).toEqual(['', '']);
    expect(stripped[0].content).toBe('a');
    expect(stripped[1].images).toBeUndefined();
    // 原数组不被就地改写
    expect(messages[0].images?.[0]).not.toBe('');
  });

  it('fillImage 回填后与原消息一致（strip → fill 往返）', () => {
    const original: HistoryMessage = userMessage('a', [imageOf(3), '', imageOf(6)]);
    let restored = stripImageBodies([original]);
    restored = fillImage(restored, 0, 0, original.images?.[0] ?? '');
    restored = fillImage(restored, 0, 2, original.images?.[2] ?? '');
    expect(restored[0].images).toEqual(original.images);
  });

  it('fillImage 越界或缺失槽位时原样返回，不抛错', () => {
    const messages: HistoryMessage[] = [userMessage('a', [''])];
    expect(fillImage(messages, 9, 0, 'x')).toBe(messages);
    expect(fillImage(messages, 0, 5, 'x')).toBe(messages);
    expect(fillImage([userMessage('no-image')], 0, 0, 'x')[0].images).toBeUndefined();
  });
});

describe('会话头刷新', () => {
  it('刷新消息数/字节数/更新时间，保留标题与 titleEdited', () => {
    const meta = { ...createSessionMeta('s1', 1000), title: '手改标题', titleEdited: true };
    const messages: HistoryMessage[] = [userMessage('abcd', [imageOf(3)])];
    const next = refreshMeta(meta, messages, 2000);
    expect(next.updatedAt).toBe(2000);
    expect(next.createdAt).toBe(1000);
    expect(next.messageCount).toBe(1);
    expect(next.textBytes).toBe(4);
    expect(next.attachmentBytes).toBe(3);
    expect(next.title).toBe('手改标题');
    expect(next.titleEdited).toBe(true);
  });
});

describe('过期坐标收缩（§8.3 消息级操作）', () => {
  it('删除中间一条：其后登记整体左移一格，自身登记消失', () => {
    const refs: ExpiredImageRef[] = [
      { msg: 0, img: 0 },
      { msg: 2, img: 1 },
      { msg: 3, img: 0 },
    ];
    expect(shiftExpiredRefsOnDelete(refs, 2)).toEqual([
      { msg: 0, img: 0 },
      { msg: 2, img: 0 },
    ]);
  });

  it('删除首条：全部左移一格', () => {
    const refs: ExpiredImageRef[] = [
      { msg: 0, img: 0 },
      { msg: 1, img: 2 },
    ];
    expect(shiftExpiredRefsOnDelete(refs, 0)).toEqual([{ msg: 0, img: 2 }]);
  });

  it('删掉末条不影响前面的坐标；空数组原样返回', () => {
    const refs: ExpiredImageRef[] = [{ msg: 0, img: 1 }];
    expect(shiftExpiredRefsOnDelete(refs, 1)).toEqual([{ msg: 0, img: 1 }]);
    expect(shiftExpiredRefsOnDelete([], 3)).toEqual([]);
  });

  it('截断后只保留仍存在的坐标', () => {
    const refs: ExpiredImageRef[] = [
      { msg: 0, img: 0 },
      { msg: 2, img: 1 },
    ];
    expect(trimExpiredRefs(refs, 2)).toEqual([{ msg: 0, img: 0 }]);
    expect(trimExpiredRefs(refs, 0)).toEqual([]);
  });
});
