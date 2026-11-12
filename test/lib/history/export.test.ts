import { describe, expect, it } from 'vitest';
import {
  buildSessionFileName,
  buildSessionMarkdown,
  formatExportTime,
  sanitizeFileStem,
} from '../../../lib/history/export.ts';
import type { ChatMsg } from '../../../lib/chat/messages.ts';
import type { ExpiredImageRef, SessionMeta } from '../../../lib/history/types.ts';

/*
 * 会话导出（doc/chat-history.md §8.2）：纯函数口径，验三件事——
 * ① 元信息与消息顺序可读；② 图片只出占位标记、绝不内联 dataURL；
 * ③ 文件名在 Windows 上能落盘（非法字符与长度）。
 */

const FIXED_TS = new Date(2026, 10, 12, 9, 5).getTime();

function meta(title: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'sess-1',
    title,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    messageCount: 0,
    textBytes: 0,
    attachmentBytes: 0,
    titleEdited: false,
    ...overrides,
  };
}

function userMsg(content: string, extra: Partial<ChatMsg> = {}): ChatMsg {
  return { role: 'user', content, ...extra };
}

function assistantMsg(content: string, extra: Partial<ChatMsg> = {}): ChatMsg {
  return { role: 'assistant', content, ...extra };
}

describe('history 导出 Markdown', () => {
  it('输出标题、元信息与逐条消息小节', () => {
    const markdown = buildSessionMarkdown(meta('二次函数求根'), [
      userMsg('这道题怎么解？'),
      assistantMsg('先配方。'),
    ]);

    expect(markdown.startsWith('# 二次函数求根')).toBe(true);
    expect(markdown).toContain('- 会话 ID：sess-1');
    expect(markdown).toContain('- 消息数：2');
    expect(markdown).toContain('## 1. 用户');
    expect(markdown).toContain('## 2. 助手');
    expect(markdown.indexOf('## 1. 用户')).toBeLessThan(markdown.indexOf('## 2. 助手'));
    expect(markdown.endsWith('\n')).toBe(true);
  });

  it('标题为空回落「新对话」', () => {
    expect(buildSessionMarkdown(meta(''), [userMsg('hi')])).toContain('# 新对话');
  });

  it('图片只出 [图片]，过期槽位出 [图片已过期]，绝不内联 dataURL', () => {
    const messages = [
      userMsg('看图', { images: ['data:image/png;base64,AAAA', ''] }),
      userMsg('再一张', { images: [''] }),
    ];
    const expired: ExpiredImageRef[] = [{ msg: 0, img: 1 }];
    const markdown = buildSessionMarkdown(meta('图片会话'), messages, expired);

    expect(markdown).toContain('图片：[图片] [图片已过期]');
    // 第 1 条（index 1）的空串槽位没登记过期，按过期兜底文案处理即可，但绝不能出现 base64
    expect(markdown).not.toContain('base64');
    expect(markdown).not.toContain('data:image');
  });

  it('附件、工具调用与思考过程按约定格式落盘', () => {
    const markdown = buildSessionMarkdown(meta('附件会话'), [
      userMsg('看这份题', { files: [{ name: '题目.txt', text: '12345' }] }),
      assistantMsg('读完再答', {
        reasoning: '先切题\n再算',
        toolCalls: [
          {
            id: 'call-1',
            name: 'search_kb',
            arguments: {},
            result: { ok: true, summary: '命中 2 条', ms: 42 },
          },
          { id: 'call-2', name: 'read_file', arguments: {} },
        ],
      }),
    ]);

    expect(markdown).toContain('- 附件：题目.txt（5 字符）');
    expect(markdown).toContain('> **思考过程**');
    expect(markdown).toContain('> 先切题');
    expect(markdown).toContain('- 工具 search_kb（成功） · 命中 2 条 · 42ms');
    expect(markdown).toContain('- 工具 read_file（未返回）');
  });

  it('本机提示与拦截消息带状态后缀，便于复盘', () => {
    const markdown = buildSessionMarkdown(meta('标记'), [
      assistantMsg('已被拦截', { blocked: true }),
      assistantMsg('本机提示', { localOnly: true }),
    ]);
    expect(markdown).toContain('## 1. 助手（已被上游拦截）');
    expect(markdown).toContain('## 2. 助手（本机提示，未上行）');
  });

  it('无正文时不留空小节', () => {
    expect(buildSessionMarkdown(meta('空'), [assistantMsg('   ')])).toContain('_（无正文）_');
  });
});

describe('history 导出文件名', () => {
  it('替换 Windows 非法字符并折叠分隔符', () => {
    expect(sanitizeFileStem('a/b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i');
    expect(sanitizeFileStem('  多   空格  ')).toBe('多-空格');
    expect(sanitizeFileStem('...')).toBe('session');
  });

  it('超长标题按码点截断', () => {
    expect(sanitizeFileStem('一'.repeat(50), 10)).toHaveLength(10);
  });

  it('文件名形如 notesync-<标题>-<yyyyMMdd-HHmm>.md', () => {
    expect(buildSessionFileName(meta('二次函数'), FIXED_TS)).toBe(
      'notesync-二次函数-20261112-0905.md'
    );
    expect(buildSessionFileName(meta(''), FIXED_TS)).toBe('notesync-新对话-20261112-0905.md');
  });

  it('时间格式化按本地时间补零', () => {
    expect(formatExportTime(FIXED_TS)).toBe('2026-11-12 09:05');
  });
});
