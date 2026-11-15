import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import { extractOfficeText } from '@/lib/intake/extract-office';

/** 字节 → File（Node ≥20 全局 File，与浏览器 File 同构） */
function toFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as BlobPart], name);
}

/** 最小合法 docx（mammoth 只需要包结构 + word/document.xml） */
async function buildDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/** 最小 pptx：extractPptxText 只读 ppt/slides/slideN.xml */
function buildSlideXml(runs: string[]): string {
  const paragraphs = runs
    .map((r) => `<a:p><a:r><a:t>${r}</a:t></a:r></a:p>`)
    .join('');
  return `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${paragraphs}</p:sld>`;
}

describe('extractOfficeText（doc/file-intake.md §7）', () => {
  it('docx：mammoth 提取段落文本', async () => {
    const bytes = await buildDocx(['你好', '世界']);
    const result = await extractOfficeText(toFile(bytes, 'a.docx'), 'docx', 1000);
    expect(result.warning).toBeUndefined();
    expect(result.text).toContain('你好');
    expect(result.text).toContain('世界');
  });

  it('pptx：按页分组、页序按编号排序、XML 实体解码', async () => {
    const zip = new JSZip();
    // 故意先塞第 2 页再塞第 1 页，验证输出按页码排序
    zip.file('ppt/slides/slide2.xml', buildSlideXml(['第二页&amp;测试']));
    zip.file('ppt/slides/slide1.xml', buildSlideXml(['第一页', '&#x4E2D;文']));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const result = await extractOfficeText(toFile(bytes, 'a.pptx'), 'pptx', 1000);
    expect(result.warning).toBeUndefined();
    expect(result.text).toContain('【第 1 页】');
    expect(result.text).toContain('【第 2 页】');
    expect(result.text.indexOf('第 1 页')).toBeLessThan(result.text.indexOf('第 2 页'));
    expect(result.text).toContain('第一页');
    expect(result.text).toContain('中文');
    expect(result.text).toContain('第二页&测试');
  });

  it('空内容降级为 warning 不抛错', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', buildSlideXml([])); // 只有空段落
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const result = await extractOfficeText(toFile(bytes, 'empty.pptx'), 'pptx', 1000);
    expect(result.text).toBe('');
    expect(result.warning).toBe('未提取到文字内容');
  });

  it('超长内容截断并留 warning', async () => {
    const bytes = await buildDocx(['x'.repeat(500)]);
    const result = await extractOfficeText(toFile(bytes, 'long.docx'), 'docx', 100);
    expect(result.text.length).toBe(100);
    expect(result.warning).toContain('已截断');
  });

  it('损坏文件降级为 warning 不抛错', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // 半个 ZIP 头
    const result = await extractOfficeText(toFile(bytes, 'broken.docx'), 'docx', 1000);
    expect(result.text).toBe('');
    expect(result.warning).toContain('解析失败');
  });
});
