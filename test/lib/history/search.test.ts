import { describe, expect, it } from 'vitest';
import {
  matchMessages,
  matchMeta,
  mergeHits,
  normalizeKeyword,
  normalizeText,
} from '../../../lib/history/search.ts';
import type { ChatMsg } from '../../../lib/chat/messages.ts';
import type { SessionMeta } from '../../../lib/history/types.ts';

/*
 * 侧栏搜索纯函数（doc/chat-history.md §7.4）：口径是"子串 + 大小写不敏感 +
 * 全角转半角"，匹配标题与正文（content / files[].text），不碰图片与推理过程。
 * 这里固化三条容易被后续改动弄丢的约定：归一化时机、正文范围、结果上限与排序。
 */

function meta(id: string, title: string, updatedAt = 0): SessionMeta {
  return {
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    messageCount: 0,
    textBytes: 0,
    attachmentBytes: 0,
    titleEdited: false,
  };
}

function msg(content: string, files: ChatMsg['files'] = []): ChatMsg {
  return { role: 'user', content, files };
}

describe('history 搜索归一化', () => {
  it('全角转半角并统一小写', () => {
    expect(normalizeText('ＡＢＣ１２３')).toBe('abc123');
    expect(normalizeText('Ｒｅａｃｔ')).toBe('react');
  });

  it('全角空格按半角处理，关键词两侧空白忽略', () => {
    expect(normalizeKeyword('　 React 　')).toBe('react');
    expect(normalizeKeyword('   ')).toBe('');
  });
});

describe('history 搜索匹配', () => {
  it('空关键词视为全部命中', () => {
    expect(matchMeta(meta('a', '周报'), '')).toBe(true);
    expect(matchMessages([msg('随便写点')], '')).toBe(true);
  });

  it('标题按子串匹配且大小写不敏感', () => {
    expect(matchMeta(meta('a', 'Next.js 路由梳理'), 'next')).toBe(true);
    expect(matchMeta(meta('a', 'Next.js 路由梳理'), 'nuxt')).toBe(false);
  });

  it('正文匹配 content 与 files[].text，不含推理过程', () => {
    const messages: ChatMsg[] = [
      msg('第一句', [{ name: 'a.txt', text: '附件里的关键词' }]),
      { role: 'assistant', content: '回答', reasoning: '推理里出现的关键词' },
    ];
    expect(matchMessages(messages, '附件里的关键词')).toBe(true);
    expect(matchMessages(messages, '推理里出现的')).toBe(false);
  });
});

describe('history 搜索结果合并', () => {
  it('去重后按 updatedAt 倒序并截断到上限', () => {
    const titleHits = [meta('a', '一', 10), meta('b', '二', 30)];
    const bodyHits = [meta('b', '二', 30), meta('c', '三', 20)];
    const merged = mergeHits(titleHits, bodyHits, 10);
    expect(merged.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('命中数超过上限时只保留最新的若干条', () => {
    const hits = Array.from({ length: 60 }, (_, index) => meta(`id-${index}`, `会话 ${index}`, index));
    const merged = mergeHits(hits, [], 50);
    expect(merged).toHaveLength(50);
    expect(merged[0].id).toBe('id-59');
  });
});
