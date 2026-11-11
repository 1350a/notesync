/**
 * /api/chat 与 /api/diagnose-paper 共用的请求附件校验（从 chat route 抽出）。
 * 非法项一律丢弃（附 console.warn 便于排查），不因一条脏数据让整批诊断失败。
 */
import type { DiagnoseAttachment, ReviseCategory } from './types.ts';

const CATEGORIES = new Set<ReviseCategory>(['origin', 'wrong', 'correct', 'analysis']);

/** 单张图片 dataUrl 上限（约 9MB 原图），超出直接丢弃，防止请求体撑爆内存 */
export const MAX_DATA_URL = 12 * 1024 * 1024;

export function parseAttachments(raw: unknown): DiagnoseAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: DiagnoseAttachment[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const category = record.category;
    if (!name || typeof category !== 'string' || !CATEGORIES.has(category as ReviseCategory)) {
      console.warn('[diagnose] 丢弃非法附件：缺少文件名或分类不属于四类标签');
      continue;
    }

    const rawUrl = typeof record.dataUrl === 'string' ? record.dataUrl : '';
    const dataUrl = rawUrl.startsWith('data:image/') ? rawUrl : undefined;
    if (rawUrl && !dataUrl) {
      console.warn(`[diagnose] ${name}：dataUrl 不是图片数据，已忽略`);
    }
    if (dataUrl && dataUrl.length > MAX_DATA_URL) {
      console.warn(`[diagnose] ${name}：图片超过 ${MAX_DATA_URL} 字符上限，已忽略`);
      continue;
    }

    const text = typeof record.text === 'string' ? record.text : undefined;
    if (!dataUrl && !text?.trim()) {
      console.warn(`[diagnose] ${name}：既无图片也无文字内容，已忽略`);
      continue;
    }

    out.push({
      name,
      category: category as ReviseCategory,
      dataUrl,
      text,
      warning: typeof record.warning === 'string' ? record.warning : undefined,
    });
  }

  return out;
}
