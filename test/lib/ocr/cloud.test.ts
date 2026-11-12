import { describe, expect, it } from 'vitest';
import {
  CloudOcrError,
  CLOUD_OCR_MAX_IMAGE_BYTES,
  decodedByteLength,
  parseImageDataUrl,
  parseLayoutParsingResponse,
} from '../../../lib/ocr/cloud.ts';

/*
 * 云端 OCR 客户端纯函数（doc/cloud-ocr.md §2/§5）：
 * dataUrl 校验是路由的第一道门禁（webp/bmp 在云端引擎下显式失败），
 * 响应解析决定空结果与结构不符的失败语义，两处都必须零依赖可测。
 */
describe('parseImageDataUrl：前缀与格式门禁（doc/cloud-ocr.md §6）', () => {
  it('合法 png / jpeg dataUrl 拆出 mime 与 base64', () => {
    expect(parseImageDataUrl('data:image/png;base64,aGVsbG8=')).toEqual({
      mime: 'image/png',
      base64: 'aGVsbG8=',
    });
    expect(parseImageDataUrl('data:image/jpeg;base64,aGVsbG8=')).toEqual({
      mime: 'image/jpeg',
      base64: 'aGVsbG8=',
    });
    // FileReader 对 .jpg 产出 jpe? 两种前缀形态都要接受
    expect(parseImageDataUrl('data:image/jpg;base64,QQ==')?.mime).toBe('image/jpeg');
  });

  it('前后空白可容忍（客户端拼接处可能带换行）', () => {
    expect(parseImageDataUrl('  data:image/png;base64,QQ==\n')?.base64).toBe('QQ==');
  });

  it('webp / bmp / gif 判 null：glm-ocr 仅收 JPG/PNG，不静默转格式', () => {
    expect(parseImageDataUrl('data:image/webp;base64,QQ==')).toBeNull();
    expect(parseImageDataUrl('data:image/bmp;base64,QQ==')).toBeNull();
    expect(parseImageDataUrl('data:image/gif;base64,QQ==')).toBeNull();
  });

  it('非 dataUrl / 非 base64 / 非字符串一律 null', () => {
    expect(parseImageDataUrl('https://example.com/a.png')).toBeNull();
    expect(parseImageDataUrl('data:image/png;base64,')).toBeNull();
    expect(parseImageDataUrl('data:text/plain;base64,QQ==')).toBeNull();
    expect(parseImageDataUrl(123)).toBeNull();
    expect(parseImageDataUrl(undefined)).toBeNull();
    expect(parseImageDataUrl(null)).toBeNull();
  });
});

describe('decodedByteLength：10MB 门禁的精确计量', () => {
  it('无 padding 按 3/4 换算', () => {
    // 4 个 base64 字符 = 3 字节
    expect(decodedByteLength('AAAA')).toBe(3);
  });

  it('按 padding 精确扣除', () => {
    // 'QQ==' → 1 字节 'A'
    expect(decodedByteLength('QQ==')).toBe(1);
    // 'QUI=' → 2 字节 'AB'
    expect(decodedByteLength('QUI=')).toBe(2);
  });

  it('上限常量为 10MB', () => {
    expect(CLOUD_OCR_MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('parseLayoutParsingResponse：成功响应与失败语义（doc/cloud-ocr.md §5）', () => {
  it('解析 md_results 并透传 layout_details；text 仅去首尾空白', () => {
    const result = parseLayoutParsingResponse({
      md_results: '  已知函数 f(x)=2x+1，求导。 \n',
      layout_details: [[{ label: 'text', content: 'f(x)=2x+1' }]],
    });
    expect(result.text).toBe('已知函数 f(x)=2x+1，求导。');
    expect(result.layoutDetails).toEqual([[{ label: 'text', content: 'f(x)=2x+1' }]]);
  });

  it('md_results 为空串是合法成功（空结果由上层按失败处理，与本地引擎同口径）', () => {
    expect(parseLayoutParsingResponse({ md_results: '' }).text).toBe('');
  });

  it('缺少 md_results / 非对象体 → parse_error', () => {
    expect(() => parseLayoutParsingResponse({})).toThrow(CloudOcrError);
    expect(() => parseLayoutParsingResponse(null)).toThrow(CloudOcrError);
    expect(() => parseLayoutParsingResponse('ok')).toThrow(CloudOcrError);
    expect(() => parseLayoutParsingResponse([1, 2])).toThrow(CloudOcrError);
    try {
      parseLayoutParsingResponse({});
    } catch (err) {
      expect(err).toBeInstanceOf(CloudOcrError);
      expect((err as CloudOcrError).code).toBe('parse_error');
    }
  });
});
