/**
 * 诊断模式文件接入 - 浏览器侧内容提取
 *
 * 只允许在客户端组件调用（依赖 FileReader 与 pdfjs 的 worker）。
 * PDF 在这里取文字而不是把整份 base64 塞给模型：多模态端点普遍不吃 PDF，
 * 而纯文本模型连图片都看不到，文字是两边都能用的最小公分母。
 */
import type { DiagnoseAttachment, DiagnoseKind, ReviseCategory } from './types.ts';

/** pdfjs worker 走本地静态资源，避免运行时依赖 CDN */
const PDF_WORKER_SRC = '/pdfjs/pdf.worker.min.mjs';
/** 单份 PDF 最多解析页数，防止超大文档卡死主线程 */
const MAX_PDF_PAGES = 80;
/** 单份 PDF 提取字符上限，与组装层预算量级对齐 */
const MAX_PDF_CHARS = 20000;

/** File → dataUrl */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** PDF → 纯文本（扫描件无文字层时返回空串） */
async function extractPdfText(file: File): Promise<string> {
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
      if (text.length >= MAX_PDF_CHARS) break;
    }
    return text.slice(0, MAX_PDF_CHARS).trim();
  } finally {
    await doc.destroy();
  }
}

/**
 * 按 detect 的判定结果取出内容。
 * 失败不抛错，一律降级为空内容 + warning，交由组装层按"未提取到内容"处理，
 * 避免单份坏文件拖垮整批诊断。
 */
export async function extractAttachment(
  file: File,
  category: ReviseCategory,
  kind: DiagnoseKind
): Promise<DiagnoseAttachment> {
  const base: DiagnoseAttachment = { name: file.name, category };

  try {
    if (kind === 'image') {
      const dataUrl = await readAsDataUrl(file);
      if (!dataUrl.startsWith('data:image/')) {
        return { ...base, warning: '图片读取结果异常，未取到有效图像数据' };
      }
      return { ...base, dataUrl };
    }

    if (kind === 'text') {
      const text = await file.text();
      return text.trim() ? { ...base, text } : { ...base, warning: '文件内容为空' };
    }

    if (kind === 'pdf') {
      const text = await extractPdfText(file);
      return text ? { ...base, text } : { ...base, warning: '未提取到文字，可能是扫描件或纯图片 PDF' };
    }

    return { ...base, warning: '该类型不在本轮支持范围内' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, warning: `内容提取失败：${message}` };
  }
}
