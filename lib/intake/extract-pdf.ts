/**
 * PDF 文字层提取（doc/file-intake.md §7，两入口共用）
 *
 * 在这里取文字而不是把整份 base64 塞给模型：多模态端点普遍不吃 PDF，
 * 纯文本模型连图都看不到，文字层是两边都能用的最小公分母。
 * 原实现自 lib/diagnose/extract.ts 迁出（聊天输入框 2026-11-14 起也收 PDF）。
 * pdfjs 动态 import：选中 PDF 才拉库；worker 走本地静态资源，不依赖 CDN。
 */

/** pdfjs worker 走本地静态资源，避免运行时依赖 CDN */
const PDF_WORKER_SRC = '/pdfjs/pdf.worker.min.mjs';

/** 单份 PDF 最多解析页数，防止超大文档卡死主线程 */
export const MAX_PDF_PAGES = 80;

/**
 * PDF → 纯文本；扫描件（无文字层）返回空串，由调用方给降级提示。
 * maxChars 由入口定：聊天 200_000（MAX_TEXT_FILE_CHARS）/ 诊断 20_000。
 */
export async function extractPdfText(file: File, maxChars: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    let text = '';
    for (let pageNo = 1; pageNo <= pages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) text += `${line}\n`;
      if (text.length >= maxChars) break;
    }
    return text.slice(0, maxChars).trim();
  } finally {
    await doc.destroy();
  }
}
