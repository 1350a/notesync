/*
 * lib/chat/messages.ts 本地检索注入校验用例
 *
 * 覆盖 doc/browser-local-inference.md §6.2 的从严口径：条数上限 4、标题 200 /
 * 片段 800 字符阈值、字段越界时整组丢弃（不抛错、不静默改写），以及注入位置
 * 只落在最后一条用户消息。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_RAG_CONTEXTS,
  RAG_SNIPPET_MAX_CHARS,
  RAG_TITLE_MAX_CHARS,
  buildProviderMessages,
  formatRagBlock,
  parseRagContexts,
  buildUserContent,
  type RagContext,
} from '@/lib/chat/messages';
import type { ProviderMessage } from '@/lib/provider/types';

/** 取 Provider 文本内容（多模态数组形态在注入用例里不应出现） */
const textOf = (content: ProviderMessage['content']): string =>
  typeof content === 'string' ? content : '';

/** 构造一条合法命中片段 */
const okContext = (overrides: Partial<RagContext> = {}): RagContext => ({
  title: '二次函数的顶点',
  snippet: '顶点坐标 (-b/2a, (4ac-b^2)/4a)',
  score: 0.62,
  ...overrides,
});

describe('ragContexts 上限常量', () => {
  it('条数与长度阈值符合协议', () => {
    expect(MAX_RAG_CONTEXTS).toBe(4);
    expect(RAG_TITLE_MAX_CHARS).toBe(200);
    expect(RAG_SNIPPET_MAX_CHARS).toBe(800);
  });
});

describe('parseRagContexts', () => {
  it('单条合法命中被保留并 trim', () => {
    const parsed = parseRagContexts([{ title: '  标题  ', snippet: ' 片段 ', score: 0.5 }]);
    expect(parsed).toEqual([{ title: '标题', snippet: '片段', score: 0.5 }]);
  });

  it('恰好 4 条时全部保留（上限临界）', () => {
    const raw = Array.from({ length: MAX_RAG_CONTEXTS }, (_, i) =>
      okContext({ title: `标题${i}` }),
    );
    expect(parseRagContexts(raw)).toHaveLength(MAX_RAG_CONTEXTS);
  });

  it('5 条整组丢弃（超上限按未提供处理）', () => {
    const raw = Array.from({ length: MAX_RAG_CONTEXTS + 1 }, (_, i) =>
      okContext({ title: `标题${i}` }),
    );
    expect(parseRagContexts(raw)).toEqual([]);
  });

  it('空数组与非数组输入均为空', () => {
    expect(parseRagContexts([])).toEqual([]);
    expect(parseRagContexts(undefined)).toEqual([]);
    expect(parseRagContexts(null)).toEqual([]);
    expect(parseRagContexts('二次函数')).toEqual([]);
    expect(parseRagContexts({ title: '标题' })).toEqual([]);
  });

  it('标题恰好 200 字符通过，201 字符整组丢弃', () => {
    expect(parseRagContexts([okContext({ title: '字'.repeat(200) })])).toHaveLength(1);
    expect(parseRagContexts([okContext({ title: '字'.repeat(201) })])).toEqual([]);
  });

  it('片段恰好 800 字符通过，801 字符整组丢弃', () => {
    expect(parseRagContexts([okContext({ snippet: '字'.repeat(800) })])).toHaveLength(1);
    expect(parseRagContexts([okContext({ snippet: '字'.repeat(801) })])).toEqual([]);
  });

  it('score 必须是 [0,1] 内的有限数', () => {
    expect(parseRagContexts([okContext({ score: 0 })])).toHaveLength(1);
    expect(parseRagContexts([okContext({ score: 1 })])).toHaveLength(1);
    expect(parseRagContexts([okContext({ score: -0.01 })])).toEqual([]);
    expect(parseRagContexts([okContext({ score: 1.01 })])).toEqual([]);
    expect(parseRagContexts([okContext({ score: Number.NaN })])).toEqual([]);
    expect(parseRagContexts([okContext({ score: Number.POSITIVE_INFINITY })])).toEqual([]);
  });

  it('score 为字符串等非数字整组丢弃', () => {
    expect(parseRagContexts([{ title: '标题', snippet: '片段', score: '0.5' }])).toEqual([]);
  });

  it('缺字段或空白字段整组丢弃', () => {
    expect(parseRagContexts([{ snippet: '片段', score: 0.5 }])).toEqual([]);
    expect(parseRagContexts([{ title: '标题', score: 0.5 }])).toEqual([]);
    expect(parseRagContexts([{ title: '标题', snippet: '片段' }])).toEqual([]);
    expect(parseRagContexts([okContext({ title: '   ' })])).toEqual([]);
    expect(parseRagContexts([okContext({ snippet: '' })])).toEqual([]);
  });

  it('条项不是对象整组丢弃', () => {
    expect(parseRagContexts(['二次函数'])).toEqual([]);
    expect(parseRagContexts([okContext(), null])).toEqual([]);
  });

  it('任一非法项导致整组丢弃（不保留合法前项）', () => {
    const parsed = parseRagContexts([okContext(), okContext({ snippet: '字'.repeat(801) })]);
    expect(parsed).toEqual([]);
  });
});

describe('formatRagBlock', () => {
  it('空数组不生成注入块', () => {
    expect(formatRagBlock([])).toBe('');
  });

  it('按序号包裹标题与片段，并带固定起止标记', () => {
    const block = formatRagBlock([okContext(), okContext({ title: '错题案例' })]);
    expect(block.startsWith('【本地检索】')).toBe(true);
    expect(block.endsWith('【/本地检索】')).toBe(true);
    expect(block).toContain('[1] 二次函数的顶点');
    expect(block).toContain('[2] 错题案例');
    expect(block).toContain('顶点坐标 (-b/2a, (4ac-b^2)/4a)');
  });
});

describe('buildProviderMessages 的检索注入', () => {
  it('只注入最后一条用户消息', () => {
    const { messages } = buildProviderMessages({
      messages: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' },
        { role: 'user', content: '第二问' },
      ],
      ragContexts: [okContext()],
    });

    expect(textOf(messages[0].content)).toBe('第一问');
    expect(textOf(messages[1].content)).toBe('第一答');
    const last = textOf(messages[2].content);
    expect(last.startsWith('【本地检索】')).toBe(true);
    expect(last.endsWith('第二问')).toBe(true);
  });

  it('无 ragContexts 时不注入', () => {
    const { messages } = buildProviderMessages({
      messages: [{ role: 'user', content: '你好' }],
    });
    expect(textOf(messages[0].content)).toBe('你好');
  });

  it('超上限的 ragContexts 整组丢弃但消息照常发送', () => {
    const raw = Array.from({ length: MAX_RAG_CONTEXTS + 1 }, (_, i) =>
      okContext({ title: `标题${i}` }),
    );
    const { messages } = buildProviderMessages({
      messages: [{ role: 'user', content: '你好' }],
      ragContexts: raw,
    });
    expect(textOf(messages[0].content)).toBe('你好');
    expect(textOf(messages[0].content)).not.toContain('【本地检索】');
  });

  it('非法 score 的命中不注入（不影响请求本身）', () => {
    const { messages } = buildProviderMessages({
      messages: [{ role: 'user', content: '你好' }],
      ragContexts: [okContext({ score: 2 })],
    });
    expect(textOf(messages[0].content)).toBe('你好');
  });
});

describe('混合档组装（doc/browser-local-ocr.md §6.2）', () => {
  const IMG = 'data:image/png;base64,xxx';

  it('imageTexts + images 同带：OCR 文本块打底 + 原图补充', () => {
    const content = buildUserContent('看这道题', [IMG], ['识别出的题干']);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as NonNullable<typeof content> & object[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(JSON.stringify(parts[0])).toContain('【图片OCR】');
    expect(parts[1]).toMatchObject({ type: 'image_url' });
  });

  it('仅 imageTexts（全本地）：不含图片本体', () => {
    const content = buildUserContent('看这道题', undefined, ['识别出的题干']);
    expect(typeof content).toBe('string');
    expect(content as string).toContain('【图片OCR】');
  });

  it('混合档消息占用图片配额，全本地消息不占用', () => {
    const { messages } = buildProviderMessages({
      messages: [
        { role: 'user', content: '全本地', imageTexts: ['旧识别文本'] },
        { role: 'user', content: '混合', imageTexts: ['新识别文本'], images: [IMG] },
      ],
    });
    const local = messages[0];
    const mixed = messages[1];
    // 全本地：纯文本块
    expect(typeof local.content).toBe('string');
    expect(local.content as string).toContain('【图片OCR】');
    // 混合：文本 + 原图
    expect(Array.isArray(mixed.content)).toBe(true);
  });
});
