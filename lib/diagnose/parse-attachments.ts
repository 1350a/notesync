/**
 * /api/chat 与 /api/diagnose-paper 共用的请求附件校验（从 chat route 抽出）。
 * 非法项一律丢弃（附 console.warn 便于排查），不因一条脏数据让整批诊断失败。
 */
import type { DiagnoseAttachment, ReviseCategory } from './types.ts';

const CATEGORIES = new Set<ReviseCategory>(['origin', 'wrong', 'correct', 'analysis']);

/** 单张图片 dataUrl 上限（约 9MB 原图），超出直接丢弃，防止请求体撑爆内存 */
export const MAX_DATA_URL = 12 * 1024 * 1024;

/**
 * 单次请求的附件条数上限。
 *
 * 单图体积已限（MAX_DATA_URL），但数组长度此前不限：一次 POST 塞几百条附件照样能把
 * 内存与组装耗时打满，而投喂侧本来只用其中少数（doc/diagnose-file-intake.md：图片
 * 投喂上限 4 张，超出降级为文字占位）。取 12 = 四类标签各 3 张，比投喂上限宽 3 倍，
 * 正常整卷够用；超量部分丢弃并留痕，不静默。
 */
export const MAX_ATTACHMENTS = 12;

export function parseAttachments(raw: unknown): DiagnoseAttachment[] {
  if (!Array.isArray(raw)) return [];
  // 超量截断放在解析前：既限制结果条数，也避免脏数据把循环次数放大
  if (raw.length > MAX_ATTACHMENTS) {
    console.warn(
      `[diagnose] 附件 ${raw.length} 条超过 ${MAX_ATTACHMENTS} 条上限，仅取前 ${MAX_ATTACHMENTS} 条`,
    );
  }
  const items = raw.length > MAX_ATTACHMENTS ? raw.slice(0, MAX_ATTACHMENTS) : raw;
  const out: DiagnoseAttachment[] = [];

  for (const item of items) {
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
      // 引擎标记严格判型：非法值丢弃该字段但不丢附件，缺省走中性「OCR」标签
      ocrEngine: record.ocrEngine === 'local' || record.ocrEngine === 'cloud' ? record.ocrEngine : undefined,
    });
  }

  return out;
}
