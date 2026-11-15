import { describe, expect, it } from 'vitest';
import { MAX_DATA_URL } from '../../../lib/chat/messages.ts';
import {
  sanitizeExpiredRefs,
  sanitizeImageSlots,
  sanitizeMessages,
  sanitizeMeta,
  sanitizeRecord,
} from '../../../lib/history/sanitize.ts';
import {
  collapseWhitespace,
  deriveTitle,
  deriveTitleFromMessages,
  normalizeTitle,
  truncateByCodePoint,
} from '../../../lib/history/title.ts';
import {
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_CHARS,
  UNTITLED_SESSION,
  createSessionMeta,
  makeBlobKey,
  parseBlobKey,
} from '../../../lib/history/types.ts';

/*
 * 会话历史的「边界层」：标题派生、脏数据清洗、附件键解析。
 * 这些是上一版本遗留数据或运行中输入的第一道防线，判定口径一旦放松，
 * 坏数据就会一路流到渲染层（图片错位、空白气泡、标题串台）。
 */

const PNG = 'data:image/png;base64,AAAA';

describe('标题派生', () => {
  it('collapseWhitespace 折叠换行为单空格并去首尾空白', () => {
    expect(collapseWhitespace('  第一行\n第二行\t\t第三  ')).toBe('第一行 第二行 第三');
    expect(collapseWhitespace('\n\n')).toBe('');
  });

  it('truncateByCodePoint 按码点截断，不劈开 emoji', () => {
    expect(truncateByCodePoint('😀😀😀', 2)).toBe('😀😀');
    expect(truncateByCodePoint('中文测试', 2)).toBe('中文');
    expect(truncateByCodePoint('短', 20)).toBe('短');
    expect(truncateByCodePoint('任意', 0)).toBe('');
    expect(truncateByCodePoint('任意', -1)).toBe('');
  });

  it('deriveTitle 取前 20 个码点，空正文回落「新对话」', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz';
    expect(deriveTitle(long)).toBe(long.slice(0, 20));
    expect(deriveTitle(long)).toHaveLength(20);
    expect(deriveTitle('   ')).toBe(UNTITLED_SESSION);
    expect(deriveTitle('')).toBe(UNTITLED_SESSION);
  });

  it('deriveTitleFromMessages 跳过只带附件的首条用户消息，往后找正文', () => {
    const messages = [
      { role: 'assistant' as const, content: '开场白' },
      { role: 'user' as const, content: '   ', images: [PNG] },
      { role: 'user' as const, content: '真正的问题' },
    ];
    expect(deriveTitleFromMessages(messages)).toBe('真正的问题');
  });

  it('deriveTitleFromMessages 找不到用户正文时回落「新对话」', () => {
    expect(deriveTitleFromMessages([])).toBe(UNTITLED_SESSION);
    expect(deriveTitleFromMessages([{ role: 'assistant', content: '只有助手' }])).toBe(
      UNTITLED_SESSION
    );
  });

  it('normalizeTitle 对非字符串/全空白返回 null（拒绝改名）', () => {
    expect(normalizeTitle(undefined)).toBeNull();
    expect(normalizeTitle(123)).toBeNull();
    expect(normalizeTitle('   ')).toBeNull();
    expect(normalizeTitle('  我的会话  ')).toBe('我的会话');
  });
});

describe('附件键', () => {
  it('makeBlobKey 与 parseBlobKey 往返一致', () => {
    const key = makeBlobKey('sess-1', 3, 7);
    expect(key).toBe('sess-1:3:7');
    expect(parseBlobKey(key)).toEqual({
      key: 'sess-1:3:7',
      sessionId: 'sess-1',
      msgIndex: 3,
      imgIndex: 7,
    });
  });

  it('parseBlobKey 拒绝各种脏 key，不抛错', () => {
    expect(parseBlobKey('')).toBeNull();
    expect(parseBlobKey('nocolon')).toBeNull();
    expect(parseBlobKey(':1:2')).toBeNull();
    expect(parseBlobKey('s:1')).toBeNull();
    expect(parseBlobKey('s:-1:2')).toBeNull();
    expect(parseBlobKey('s:1.5:2')).toBeNull();
    expect(parseBlobKey('s:1:x')).toBeNull();
  });

  it('createSessionMeta 给出空会话头部', () => {
    expect(createSessionMeta('s1', 100)).toEqual({
      id: 's1',
      title: UNTITLED_SESSION,
      createdAt: 100,
      updatedAt: 100,
      messageCount: 0,
      textBytes: 0,
      attachmentBytes: 0,
      titleEdited: false,
    });
  });
});

describe('消息清洗', () => {
  it('非法 role、非对象条目整条丢弃', () => {
    const raw = [
      { role: 'system', content: '系统' },
      'string',
      null,
      { role: 'user', content: '保留' },
    ];
    expect(sanitizeMessages(raw).map((message) => message.content)).toEqual(['保留']);
  });

  it('非数组输入返回空数组', () => {
    expect(sanitizeMessages(undefined)).toEqual([]);
    expect(sanitizeMessages({})).toEqual([]);
  });

  it('同 id 去重，保留首条', () => {
    const raw = [
      { role: 'user', id: 'm1', content: '旧' },
      { role: 'user', id: 'm1', content: '新' },
      { role: 'user', id: 'm2', content: '独立' },
    ];
    expect(sanitizeMessages(raw).map((message) => message.content)).toEqual(['旧', '独立']);
  });

  it('空白 assistant 气泡丢弃，但带 reasoning / 工具轨迹的保留', () => {
    const raw = [
      { role: 'user', content: '问' },
      { role: 'assistant', content: '   ' },
      { role: 'assistant', content: '', reasoning: '想了很久' },
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'read_file' }] },
    ];
    const out = sanitizeMessages(raw);
    expect(out).toHaveLength(3);
    expect(out[1].reasoning).toBe('想了很久');
    expect(out[2].toolCalls).toHaveLength(1);
  });

  it('空白 user 气泡丢弃，但带图片的保留', () => {
    const raw = [
      { role: 'user', content: '   ' },
      { role: 'user', content: '', images: [PNG] },
    ];
    expect(sanitizeMessages(raw)).toHaveLength(1);
  });

  it('正文超限按 MAX_MESSAGE_CHARS 截断', () => {
    const long = 'a'.repeat(MAX_MESSAGE_CHARS + 10);
    const [message] = sanitizeMessages([{ role: 'user', content: long }]);
    expect(message.content).toHaveLength(MAX_MESSAGE_CHARS);
  });
});

describe('图片槽位清洗', () => {
  it('合法 dataURL 保留，非法项置空串且保位', () => {
    const slots = sanitizeImageSlots([PNG, '', 'http://a.png', 123, `data:image/png;base64,${'A'.repeat(MAX_DATA_URL)}`]);
    expect(slots).toHaveLength(5);
    expect(slots[0]).toBe(PNG);
    expect(slots.slice(1)).toEqual(['', '', '', '']);
  });

  it('槽位数超过上限时截断，防止脏数据撑爆数组', () => {
    const raw = new Array(MAX_IMAGES_PER_MESSAGE + 5).fill(PNG);
    expect(sanitizeImageSlots(raw)).toHaveLength(MAX_IMAGES_PER_MESSAGE);
  });

  it('非数组输入返回空数组', () => {
    expect(sanitizeImageSlots(undefined)).toEqual([]);
    expect(sanitizeImageSlots('x')).toEqual([]);
  });

  it('消息清洗时 ocrTexts 与 images 下标对齐，全空则省略', () => {
    const [message] = sanitizeMessages([
      { role: 'user', content: '图', images: [PNG, ''], ocrTexts: ['文字'] },
    ]);
    expect(message.ocrTexts).toEqual(['文字', '']);

    const [noOcr] = sanitizeMessages([{ role: 'user', content: '图', images: [PNG] }]);
    expect(noOcr.ocrTexts).toBeUndefined();
  });
});

describe('过期坐标清洗', () => {
  it('丢掉越界 msg、非整数、负数，并按 (msg, img) 去重', () => {
    const raw = [
      { msg: 0, img: 0 },
      { msg: 0, img: 0 },
      { msg: 2, img: 0 },
      { msg: -1, img: 0 },
      { msg: 0, img: -1 },
      { msg: 0.5, img: 0 },
      { msg: '0', img: 0 },
      null,
    ];
    expect(sanitizeExpiredRefs(raw, 2)).toEqual([{ msg: 0, img: 0 }]);
  });

  it('非数组输入返回空数组', () => {
    expect(sanitizeExpiredRefs(undefined, 3)).toEqual([]);
  });
});

describe('会话体与会话头清洗', () => {
  it('record 缺 id 视为损坏返回 null', () => {
    expect(sanitizeRecord({ messages: [] })).toBeNull();
    expect(sanitizeRecord(null)).toBeNull();
    expect(sanitizeRecord([])).toBeNull();
  });

  it('record 的 messages 非数组时退化为空会话', () => {
    expect(sanitizeRecord({ id: 's1', messages: 'bad' })).toEqual({
      id: 's1',
      messages: [],
      expiredImages: [],
    });
  });

  it('meta 时间戳非法回落 0、updatedAt 缺省继承 createdAt、计数取整', () => {
    const meta = sanitizeMeta({
      id: 's1',
      title: '  会话  ',
      createdAt: 100,
      updatedAt: 'bad',
      messageCount: 3.8,
      textBytes: -5,
      attachmentBytes: Number.NaN,
    });
    expect(meta).toEqual({
      id: 's1',
      title: '会话',
      createdAt: 100,
      updatedAt: 100,
      messageCount: 3,
      textBytes: 0,
      attachmentBytes: 0,
      titleEdited: false,
    });
  });

  it('meta 缺 id 返回 null；空标题回落「新对话」', () => {
    expect(sanitizeMeta({ title: 'x' })).toBeNull();
    expect(sanitizeMeta({ id: 's1', title: '   ' })?.title).toBe(UNTITLED_SESSION);
  });

  it('meta 的 titleEdited 只认 true', () => {
    expect(sanitizeMeta({ id: 's1', titleEdited: 'yes' })?.titleEdited).toBe(false);
    expect(sanitizeMeta({ id: 's1', titleEdited: true })?.titleEdited).toBe(true);
  });
});
