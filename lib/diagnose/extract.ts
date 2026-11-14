/**
 * 诊断模式文件接入 - 浏览器侧内容提取
 *
 * 只允许在客户端组件调用（依赖 FileReader 与 pdfjs 的 worker）。
 * 图片 / 文本 / Office 的提取委托 `lib/intake/`（doc/file-intake.md，两入口
 * 统一口径）；PDF 在这里取文字而不是把整份 base64 塞给模型：多模态端点
 * 普遍不吃 PDF，而纯文本模型连图片都看不到，文字是两边都能用的最小公分母。
 */
import { decodeTextFile } from '../intake/decode-text.ts';
import { extractImageIntake } from '../intake/extract-image.ts';
import { extractOfficeText, type OfficeExtractResult } from '../intake/extract-office.ts';
import { extractPdfText } from '../intake/extract-pdf.ts';
import { parseDocViaServer } from '../intake/parse-doc-client.ts';
import type { OfficeFormat } from '../intake/detect.ts';
import type { DiagnoseAttachment, DiagnoseKind, ReviseCategory } from './types.ts';

/** 单份 PDF 提取字符上限，与组装层预算量级对齐（页数上限在 intake 模块内） */
const MAX_PDF_CHARS = 20000;
/** Office 提取字符上限：与 PDF 对齐（doc/file-intake.md §7），聊天侧另有 20 万上限 */
const MAX_OFFICE_CHARS = 20000;

/** Office / .doc 统一转 DiagnoseAttachment：text 通道，warning 透传 */
function officeAttachment(
  name: string,
  category: ReviseCategory,
  result: OfficeExtractResult
): DiagnoseAttachment {
  if (!result.text.trim()) {
    return { name, category, warning: result.warning ?? '未提取到内容' };
  }
  return { name, category, text: result.text, warning: result.warning };
}

/**
 * 按 detect 的判定结果取出内容。
 * 失败不抛错，一律降级为空内容 + warning，交由组装层按"未提取到内容"处理，
 * 避免单份坏文件拖垮整批诊断。
 */
export async function extractAttachment(
  file: File,
  category: ReviseCategory,
  kind: DiagnoseKind,
  /** detect 判出的具体格式；kind === 'office' 时必为 docx/pptx/xlsx/xls 之一 */
  format = ''
): Promise<DiagnoseAttachment> {
  const base: DiagnoseAttachment = { name: file.name, category };

  try {
    if (kind === 'image') {
      // intake 已做 heic 阶梯 / 规范化 / 缩放（doc/file-intake.md §5~§6）
      const result = await extractImageIntake(file);
      return result.ok
        ? { ...base, dataUrl: result.dataUrl }
        : { ...base, warning: result.reason };
    }

    if (kind === 'text') {
      const decoded = await decodeTextFile(file);
      if (!decoded.ok) return { ...base, warning: decoded.reason };
      return decoded.text.trim()
        ? { ...base, text: decoded.text }
        : { ...base, warning: '文件内容为空' };
    }

    if (kind === 'pdf') {
      const text = await extractPdfText(file, MAX_PDF_CHARS);
      return text ? { ...base, text } : { ...base, warning: '未提取到文字，可能是扫描件或纯图片 PDF' };
    }

    if (kind === 'office') {
      const result = await extractOfficeText(file, format as OfficeFormat, MAX_OFFICE_CHARS);
      return officeAttachment(file.name, category, result);
    }

    if (kind === 'doc') {
      // 旧版 Word 浏览器无解，上传至自有服务端解析（doc/file-intake.md §8）
      const result = await parseDocViaServer(file);
      if (!result.ok) return { ...base, warning: result.reason };
      return result.text.trim()
        ? { ...base, text: result.text }
        : { ...base, warning: '服务端未提取到文字内容' };
    }

    return { ...base, warning: '该类型不在本轮支持范围内' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, warning: `内容提取失败：${message}` };
  }
}
