import { describe, expect, it } from 'vitest';

import { decodeTextBuffer, type DecodedText } from '@/lib/intake/decode-text';

/** Buffer → 独立 ArrayBuffer（规避 Buffer 池的 byteOffset 偏移） */
function ab(buf: Buffer): ArrayBuffer {
  return new Uint8Array(buf).buffer;
}

/** GBK 手工字节（Node 无 GBK 编码器）：'中'=D6D0 '文'=CEC4 '测'=B2E2 '试'=CAD4 */
const GBK_ZHONGWENCESHI = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]);

describe('decodeTextBuffer 编码探测（doc/file-intake.md §4）', () => {
  it('空缓冲返回空文本', () => {
    const result: DecodedText = decodeTextBuffer(new ArrayBuffer(0));
    expect(result).toEqual({ ok: true, text: '', encoding: 'utf-8' });
  });

  it('无 BOM 的 UTF-8 中文按 UTF-8 解码', () => {
    const result = decodeTextBuffer(ab(Buffer.from('中文测试', 'utf8')));
    expect(result).toEqual({ ok: true, text: '中文测试', encoding: 'utf-8' });
  });

  it('UTF-8 BOM 剥离后解码', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('题目', 'utf8')]);
    const result = decodeTextBuffer(ab(buf));
    expect(result).toEqual({ ok: true, text: '题目', encoding: 'utf-8' });
  });

  it('UTF-16LE BOM 解码（Windows 记事本"Unicode"档）', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文', 'utf16le')]);
    const result = decodeTextBuffer(ab(buf));
    expect(result).toEqual({ ok: true, text: '中文', encoding: 'utf-16le' });
  });

  it('UTF-16BE BOM 解码', () => {
    const le = Buffer.from('中文', 'utf16le');
    // LE 字节序手工翻成 BE：每 16 位码元高低字节对调
    const be = Buffer.from(le);
    for (let i = 0; i < be.length; i += 2) {
      const tmp = be[i];
      be[i] = be[i + 1];
      be[i + 1] = tmp;
    }
    const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
    const result = decodeTextBuffer(ab(buf));
    expect(result).toEqual({ ok: true, text: '中文', encoding: 'utf-16be' });
  });

  it('GBK 字节（非法 UTF-8 序列）落 GB18030 兜底不乱码', () => {
    const result = decodeTextBuffer(ab(Buffer.from(GBK_ZHONGWENCESHI)));
    expect(result).toEqual({ ok: true, text: '中文测试', encoding: 'gb18030' });
  });

  it('NUL 占比超阈值判二进制拒收', () => {
    const result = decodeTextBuffer(ab(Buffer.alloc(64, 0)));
    expect(result).toMatchObject({ ok: false });
  });

  it('GBK 列名的 CSV 不乱码（Excel 导出常见痛点场景）', () => {
    const buf = Buffer.concat([
      GBK_ZHONGWENCESHI.subarray(0, 2), // '中'
      Buffer.from(',90\n', 'latin1'),
    ]);
    const result = decodeTextBuffer(ab(buf));
    expect(result).toMatchObject({ ok: true, encoding: 'gb18030' });
    expect((result as { ok: true; text: string }).text).toContain(',90');
  });
});
