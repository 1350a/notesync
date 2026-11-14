import { describe, expect, it } from 'vitest';

import {
  classifyIntake,
  isOleCompoundFile,
  sniffImageFormat,
} from '@/lib/intake/detect';

const u8 = (...bytes: number[]) => new Uint8Array(bytes);

/** OLE 复合文档魔数（doc/xls/ppt 旧版二进制共用） */
const OLE_HEAD = u8(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);

describe('sniffImageFormat 魔数表（doc/file-intake.md §3）', () => {
  it('JPEG / PNG / WEBP / BMP / GIF / ICO / TIFF', () => {
    expect(sniffImageFormat(u8(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('jpeg');
    expect(sniffImageFormat(u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(sniffImageFormat(u8(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('webp');
    // BM + DIB 头长度 40（BITMAPINFOHEADER）才是 BMP
    const bmp = u8(0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 0, 0, 0);
    expect(sniffImageFormat(bmp)).toBe('bmp');
    expect(sniffImageFormat(u8(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('gif');
    expect(sniffImageFormat(u8(0x00, 0x00, 0x01, 0x00))).toBe('ico');
    expect(sniffImageFormat(u8(0x49, 0x49, 0x2a, 0x00))).toBe('tiff');
  });

  it('"BMW..." 文本不会误判为 BMP（DIB 头长度校验）', () => {
    const bmw = new Uint8Array(Buffer.from('BMW is a car'));
    expect(sniffImageFormat(bmw)).toBeNull();
  });

  it('ftyp brand：heic/avif 识别，mp4（isom）明确拒绝', () => {
    const box = (brand: string) => {
      const bytes = [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]; // 'ftyp' at 4..8
      for (const ch of brand) bytes.push(ch.charCodeAt(0));
      return u8(...bytes);
    };
    expect(sniffImageFormat(box('heic'))).toBe('heic');
    expect(sniffImageFormat(box('mif1'))).toBe('heic');
    expect(sniffImageFormat(box('avif'))).toBe('avif');
    expect(sniffImageFormat(box('isom'))).toBe('ftyp-unknown');
  });

  it('OLE 魔数', () => {
    expect(isOleCompoundFile(OLE_HEAD)).toBe(true);
    expect(isOleCompoundFile(u8(0x50, 0x4b, 0x03, 0x04))).toBe(false);
  });
});

describe('classifyIntake 判定（doc/file-intake.md §3）', () => {
  it('iOS 相册陷阱：.HEIC 文件名 + JPEG 内容按 JPEG 放行', () => {
    const result = classifyIntake('IMG_0001.HEIC', 'image/jpeg', u8(0xff, 0xd8, 0xff, 0xe0));
    expect(result).toEqual({ category: 'image', format: 'jpeg' });
  });

  it('魔数优先于扩展名：gif 魔数拒收、heic 魔数进阶梯', () => {
    expect(classifyIntake('a.jpg', 'image/gif', u8(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)).category).toBe('rejected');
    expect(classifyIntake('a.jpg', '', u8(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)).category).toBe('rejected');
    const heic = u8(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
    expect(classifyIntake('a.jpg', '', heic)).toEqual({ category: 'image', format: 'heic' });
  });

  it('mp4 容器（ftyp isom）拒收', () => {
    const mp4 = u8(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
    expect(classifyIntake('a.mp4', 'video/mp4', mp4).category).toBe('rejected');
  });

  it('OLE + 扩展名：doc 走服务端解析，xls/ppt/未知 OLE 拒收', () => {
    expect(classifyIntake('a.doc', '', OLE_HEAD)).toEqual({ category: 'doc', format: 'doc' });
    const xlsResult = classifyIntake('a.xls', '', OLE_HEAD);
    expect(xlsResult.category).toBe('rejected');
    expect(xlsResult.reason).toContain('CSV');
    expect(classifyIntake('a.ppt', '', OLE_HEAD).category).toBe('rejected');
    expect(classifyIntake('a.msi', '', OLE_HEAD).category).toBe('rejected');
  });

  it('无魔数时按扩展名/MIME：office/doc/pdf 接入，ppt/wps/svg/gif/xlsx/xls 拒收', () => {
    expect(classifyIntake('a.docx', '', null)).toEqual({ category: 'office', format: 'docx' });
    expect(classifyIntake('a.pptx', '', null)).toEqual({ category: 'office', format: 'pptx' });
    expect(classifyIntake('a.doc', '', null)).toEqual({ category: 'doc', format: 'doc' });
    expect(classifyIntake('a.pdf', 'application/pdf', null)).toEqual({ category: 'pdf', format: 'pdf' });
    expect(classifyIntake('a.txt', '', null)).toEqual({ category: 'text', format: 'txt' });
    expect(classifyIntake('a', 'text/plain', null)).toEqual({ category: 'text', format: '' });
    for (const name of ['a.ppt', 'a.wps', 'a.svg', 'a.gif', 'a.xlsx', 'a.xls']) {
      const result = classifyIntake(name, '', null);
      expect(result.category, name).toBe('rejected');
    }
    // 表格拒收必须给 CSV 指引（CSV 走纯文本通道兜底）
    expect(classifyIntake('a.xlsx', '', null).reason).toContain('CSV');
    expect(classifyIntake('a.exe', '', null).category).toBe('rejected');
  });

  it('heic 扩展名但无魔数：仍给三级阶梯一次机会', () => {
    expect(classifyIntake('a.heic', '', null)).toEqual({ category: 'image', format: 'heic' });
  });

  it('无魔数退化路径：常见图片扩展名/MIME 仍判为图片（jpg 归一 jpeg）', () => {
    expect(classifyIntake('a.JPG', '', null)).toEqual({ category: 'image', format: 'jpeg' });
    expect(classifyIntake('a.png', '', null)).toEqual({ category: 'image', format: 'png' });
    expect(classifyIntake('a', 'image/webp', null)).toEqual({ category: 'image', format: 'webp' });
    expect(classifyIntake('a', 'image/gif', null).category).toBe('rejected');
  });

  it('未知 image/* MIME 拒收而非静默放行', () => {
    expect(classifyIntake('a.xyz', 'image/x-xyz', null).category).toBe('rejected');
  });
});
