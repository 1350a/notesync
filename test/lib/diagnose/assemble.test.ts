import { describe, expect, it } from 'vitest';
import {
  assembleDiagnoseMessage,
  resolveAssembleImageMode,
} from '../../../lib/diagnose/assemble.ts';
import type { DiagnoseAttachment } from '../../../lib/diagnose/types.ts';

const IMG = 'data:image/png;base64,AAAA';

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** 取组装结果的 part 数组（content 也可能是纯字符串，本链路只会是数组） */
function parts(result: ReturnType<typeof assembleDiagnoseMessage>): Part[] {
  const content = result.message?.content;
  return Array.isArray(content) ? (content as Part[]) : [];
}

/** 取组装结果里所有文本 part 的正文 */
function texts(result: ReturnType<typeof assembleDiagnoseMessage>): string[] {
  return parts(result)
    .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text);
}

/** 取组装结果里所有图片 part 的 url，顺序即投喂顺序 */
function imageUrls(result: ReturnType<typeof assembleDiagnoseMessage>): string[] {
  return parts(result)
    .filter((part): part is Extract<Part, { type: 'image_url' }> => part.type === 'image_url')
    .map((part) => part.image_url.url);
}

const plainImage: DiagnoseAttachment = { name: 'a.png', category: 'origin', dataUrl: IMG };
const mixedImage: DiagnoseAttachment = {
  name: 'b.png',
  category: 'wrong',
  dataUrl: IMG,
  text: '第 3 题：先移项再合并同类项。',
};

describe('投喂方式推导（diagnose-file-intake.md §6 三档）', () => {
  it('模型不收图 → text-only（附件形态不再影响结论）', () => {
    expect(resolveAssembleImageMode([mixedImage], false)).toBe('text-only');
    expect(resolveAssembleImageMode([plainImage], false)).toBe('text-only');
    expect(resolveAssembleImageMode([], false)).toBe('text-only');
  });

  it('有附件同时带原图与 OCR 文本 → mixed', () => {
    expect(resolveAssembleImageMode([plainImage, mixedImage], true)).toBe('mixed');
  });

  it('只有原图或只有文本 → multimodal', () => {
    expect(resolveAssembleImageMode([plainImage], true)).toBe('multimodal');
    expect(
      resolveAssembleImageMode([{ name: 'c.pdf', category: 'analysis', text: '正文' }], true)
    ).toBe('multimodal');
    expect(resolveAssembleImageMode([], true)).toBe('multimodal');
  });
});

describe('混合档组装：OCR 文本打底 + 原图补充', () => {
  it('先文本后图，图片与文本各计一次', () => {
    const result = assembleDiagnoseMessage([mixedImage], { imageMode: 'mixed' });
    const content = parts(result);
    const firstImageAt = content.findIndex((part) => part.type === 'image_url');
    const ocrAt = content.findIndex(
      // 附件未记录引擎（旧客户端形态）→ 中性「OCR」，不写死引擎
      (part) => part.type === 'text' && part.text.includes('· OCR]')
    );

    expect(ocrAt).toBeGreaterThanOrEqual(0);
    expect(firstImageAt).toBeGreaterThan(ocrAt);
    expect(imageUrls(result)).toEqual([IMG]);
    expect(result.stats.images).toBe(1);
    expect(result.stats.texts).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('OCR 文本按整目录口径并入正文，不只发图', () => {
    const result = assembleDiagnoseMessage([mixedImage], { imageMode: 'mixed' });
    expect(texts(result).join('\n')).toContain('先移项再合并同类项');
  });

  it('直传档收到混合形态附件：只发图，且留痕不静默丢 OCR 文本', () => {
    const result = assembleDiagnoseMessage([mixedImage], { imageMode: 'multimodal' });
    expect(imageUrls(result)).toEqual([IMG]);
    expect(result.stats.texts).toBe(0);
    expect(texts(result).join('\n')).not.toContain('先移项');
    expect(result.warnings.join('\n')).toContain('直传档不投喂OCR文本');
  });

  it('模型不收图但有 OCR 文本：改用 OCR 文本，不发占位、不发图', () => {
    const result = assembleDiagnoseMessage([mixedImage], { imageMode: 'text-only' });
    expect(imageUrls(result)).toEqual([]);
    expect(result.stats.images).toBe(0);
    expect(texts(result).join('\n')).toContain('先移项再合并同类项');
    expect(texts(result).join('\n')).not.toContain('[图片 b.png]');
    expect(result.warnings.join('\n')).toContain('已改用OCR文本');
  });

  it('模型不收图且无 OCR 文本：仍降级为文字占位', () => {
    const result = assembleDiagnoseMessage([plainImage], { imageMode: 'text-only' });
    expect(imageUrls(result)).toEqual([]);
    expect(texts(result).join('\n')).toContain('[图片 a.png]');
    expect(result.warnings.join('\n')).toContain('已降级为文字占位');
  });

  it('混合档超图片上限：图片不再上行，OCR 文本全保留', () => {
    const items: DiagnoseAttachment[] = [
      { name: 'x1.png', category: 'wrong', dataUrl: IMG, text: '第一张的识别文本' },
      { name: 'x2.png', category: 'wrong', dataUrl: IMG, text: '第二张的识别文本' },
    ];
    const result = assembleDiagnoseMessage(items, { imageMode: 'mixed', maxImages: 1 });

    expect(result.stats.images).toBe(1);
    expect(result.stats.texts).toBe(2);
    const joined = texts(result).join('\n');
    expect(joined).toContain('第一张的识别文本');
    expect(joined).toContain('第二张的识别文本');
    expect(joined).not.toContain('[图片 x2.png]');
    expect(result.warnings.join('\n')).toContain('超出图片数量上限');
  });

  it('混合档 OCR 文本受单文件字符预算约束，截断留痕', () => {
    const long: DiagnoseAttachment = {
      name: 'long.png',
      category: 'origin',
      dataUrl: IMG,
      text: 'x'.repeat(50),
    };
    const result = assembleDiagnoseMessage([long], {
      imageMode: 'mixed',
      totalChars: 10,
      minCharsPerFile: 10,
    });

    expect(result.stats.chars).toBe(10);
    expect(result.warnings.join('\n')).toContain('OCR文本超出单文件');
  });
});

describe('OCR 标签按附件引擎分流（diagnose-file-intake.md §5 ocrEngine）', () => {
  const ocrImage = (engine: 'local' | 'cloud' | undefined): DiagnoseAttachment => ({
    name: 'img.png',
    category: 'origin',
    dataUrl: IMG,
    text: '识别文本',
    ...(engine ? { ocrEngine: engine } : {}),
  });

  it('text-only 路径：云端引擎标注「云端OCR」', () => {
    const result = assembleDiagnoseMessage([ocrImage('cloud')], { imageMode: 'text-only' });
    expect(texts(result).join('\n')).toContain('[文件 img.png · 云端OCR]');
  });

  it('text-only 路径：本地引擎标注「本地OCR」', () => {
    const result = assembleDiagnoseMessage([ocrImage('local')], { imageMode: 'text-only' });
    expect(texts(result).join('\n')).toContain('[文件 img.png · 本地OCR]');
  });

  it('缺省引擎（旧客户端）：中性「OCR」，不写死引擎', () => {
    const result = assembleDiagnoseMessage([ocrImage(undefined)], { imageMode: 'text-only' });
    const joined = texts(result).join('\n');
    expect(joined).toContain('[文件 img.png · OCR]');
    expect(joined).not.toContain('云端OCR');
    expect(joined).not.toContain('本地OCR');
  });

  it('截断告警随引擎标注', () => {
    const long: DiagnoseAttachment = {
      name: 'long.png',
      category: 'origin',
      dataUrl: IMG,
      text: 'x'.repeat(50),
      ocrEngine: 'cloud',
    };
    const result = assembleDiagnoseMessage([long], {
      imageMode: 'mixed',
      totalChars: 10,
      minCharsPerFile: 10,
    });
    expect(result.warnings.join('\n')).toContain('云端OCR文本超出单文件');
  });
});
