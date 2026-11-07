/**
 * 诊断模式文件接入 - 类型判定（纯函数，无运行时依赖）
 *
 * 判定顺序：扩展名 → 传入 MIME → 无法识别。
 * 扩展名优先是因为浏览器给的 MIME 在 Windows 上经常是空串或
 * `application/octet-stream`，靠它判不出图片/PDF。
 */
import type { DetectResult, DiagnoseKind } from './types.ts';

/** 扩展名 → MIME（覆盖本轮链路支持与需要明确拒收的类型） */
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  wps: 'application/vnd.ms-works',
};

/** MIME → 文件种类 */
function kindOfMime(mime: string): DiagnoseKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/')) return 'text';
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.ms-works' ||
    mime.includes('wordprocessingml')
  ) {
    return 'doc';
  }
  return 'unsupported';
}

/** 拒收原因：直接决定前端提示文案，不要在这里泛化成"暂不支持" */
function rejectReason(kind: DiagnoseKind, name: string): string | undefined {
  if (kind === 'doc') return `${name}：本轮暂不支持 Word 文档，请另存为 PDF 或截图后上传`;
  if (kind === 'unsupported') return `${name}：无法识别的文件类型，仅支持图片 / PDF / 纯文本`;
  return undefined;
}

/** 按文件名与可选 MIME 判定文件种类 */
export function detectFile(name: string, mime?: string): DetectResult {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const byExt = ext ? EXT_MIME[ext] : undefined;
  const normalizedMime = (byExt ?? mime ?? '').trim().toLowerCase();

  if (!normalizedMime) {
    return {
      kind: 'unsupported',
      supported: false,
      mime: '',
      reason: `${name}：无法识别的文件类型，仅支持图片 / PDF / 纯文本`,
    };
  }

  const kind = kindOfMime(normalizedMime);
  const reason = rejectReason(kind, name);
  return { kind, supported: !reason, mime: normalizedMime, reason };
}
