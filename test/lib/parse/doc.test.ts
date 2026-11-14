import { describe, expect, it } from 'vitest';

import { PARSE_DOC_MAX_BYTES, ParseDocError, parseDocBuffer, parseDocDataUrl } from '@/lib/parse/doc';

/** 手工 OLE 头：parseDocDataUrl 只校验前 8 字节魔数（doc/file-intake.md §8） */
function oleBuffer(total = 64): Buffer {
  const buf = Buffer.alloc(total);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  return buf;
}

describe('parseDocDataUrl 校验（doc/file-intake.md §8）', () => {
  it('上限常量为 20MB', () => {
    expect(PARSE_DOC_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it('非 base64 dataUrl 拒收', () => {
    expect(() => parseDocDataUrl('not-a-dataurl')).toThrow(ParseDocError);
    expect(() => parseDocDataUrl('data:text/plain,hello')).toThrow(ParseDocError);
  });

  it('OLE 魔数不符拒收（伪装成 .doc 的文件）', () => {
    const b64 = Buffer.from('plain text, not OLE').toString('base64');
    expect(() => parseDocDataUrl(`data:application/msword;base64,${b64}`)).toThrow(/OLE 魔数/);
  });

  it('空解码拒收', () => {
    expect(() => parseDocDataUrl('data:application/msword;base64,')).toThrow(/为空/);
  });

  it('OLE 魔数匹配放行并还原字节', () => {
    const bytes = oleBuffer();
    const buffer = parseDocDataUrl(`data:application/msword;base64,${bytes.toString('base64')}`);
    expect(buffer.length).toBe(bytes.length);
    expect(buffer.subarray(0, 8)).toEqual(bytes.subarray(0, 8));
  });
});

describe('parseDocBuffer 解析', () => {
  it('非 Word 的 OLE 容器报 parse_error（word-extractor 拒析）', async () => {
    await expect(parseDocBuffer(oleBuffer())).rejects.toThrow(/解析失败/);
  });
});
