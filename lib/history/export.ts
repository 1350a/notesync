/**
 * 会话导出（doc/chat-history.md §8.2）。
 *
 * 导出物是给人读的 Markdown：正文原样保留（可再粘贴回任何 Markdown 编辑器），
 * 图片**绝不内联 dataURL**——一张手机照片的 base64 就能把文件撑到几 MB，
 * 导出的意义是"带走内容"，不是"带走二进制"。图片只留占位标记。
 *
 * buildSessionMarkdown / buildSessionFileName 是纯函数（node 环境可单测）；
 * exportSessionMarkdown 是浏览器侧组合动作（读库 → 生成 → 触发下载）。
 */
import { getHistoryStorage } from './storage.ts';
import { truncateByCodePoint } from './title.ts';
import { UNTITLED_SESSION } from './types.ts';
import type { ExpiredImageRef, HistoryMessage, SessionMeta } from './types.ts';

/** 正常图片槽位的占位标记（本体在浏览器 blobs 表里，不进导出物） */
const IMAGE_PLACEHOLDER = '[图片]';
/** 被容量淘汰的槽位标记 */
const EXPIRED_PLACEHOLDER = '[图片已过期]';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地时间 `YYYY-MM-DD HH:mm`：导出物给用户看，不做时区转换 */
export function formatExportTime(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
}

function roleLabel(role: HistoryMessage['role']): string {
  return role === 'user' ? '用户' : '助手';
}

/** 把某条消息的图片槽位翻成占位标记；命中过期登记的输出 `[图片已过期]` */
function renderImageSlots(
  message: HistoryMessage,
  msgIndex: number,
  expired: ExpiredImageRef[]
): string[] {
  const slots = message.images ?? [];
  if (slots.length === 0) return [];
  const expiredImgs = new Set(
    expired.filter((ref) => ref.msg === msgIndex).map((ref) => ref.img)
  );
  return slots.map((src, imgIndex) => {
    // 落库形态里图片本体一律被 strip 成空串，所以"有没有图"看的是过期登记而非 src
    if (expiredImgs.has(imgIndex) || src === '') return EXPIRED_PLACEHOLDER;
    return IMAGE_PLACEHOLDER;
  });
}

/** 文本附件清单：只写文件名与字符数，正文已在消息里 */
function renderFiles(message: HistoryMessage): string[] {
  return (message.files ?? []).map(
    (file) => `- 附件：${file.name}（${file.text.length} 字符）`
  );
}

/** 工具调用轨迹：一行一条，失败也保留（复盘时顺序与成败都是信息） */
function renderToolCalls(message: HistoryMessage): string[] {
  const calls = message.toolCalls ?? [];
  if (calls.length === 0) return [];
  return calls.map((call) => {
    const status = call.result ? (call.result.ok ? '成功' : '失败') : '未返回';
    const summary = call.result?.summary ? ` · ${call.result.summary}` : '';
    const ms = call.result ? ` · ${call.result.ms}ms` : '';
    return `- 工具 ${call.name}（${status}）${summary}${ms}`;
  });
}

/** 思考过程折叠成引用块：默认展开会淹没正文 */
function renderReasoning(reasoning: string): string[] {
  const body = reasoning
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return ['> **思考过程**', '>', body, ''];
}

/**
 * 生成会话 Markdown。
 * @param expired 该会话的过期图片坐标（来自 `SessionRecord.expiredImages`）
 */
export function buildSessionMarkdown(
  meta: SessionMeta,
  messages: HistoryMessage[],
  expired: ExpiredImageRef[] = []
): string {
  const title = meta.title || UNTITLED_SESSION;
  const lines: string[] = [
    `# ${title}`,
    '',
    `- 会话 ID：${meta.id}`,
    `- 创建时间：${formatExportTime(meta.createdAt)}`,
    `- 最后更新：${formatExportTime(meta.updatedAt)}`,
    `- 消息数：${messages.length}`,
    '',
    '---',
    '',
  ];

  messages.forEach((message, index) => {
    const flags: string[] = [];
    if (message.localOnly) flags.push('本机提示，未上行');
    if (message.blocked) flags.push('已被上游拦截');
    const suffix = flags.length > 0 ? `（${flags.join('；')}）` : '';
    lines.push(`## ${index + 1}. ${roleLabel(message.role)}${suffix}`, '');

    if (message.reasoning) lines.push(...renderReasoning(message.reasoning));

    const body = message.content?.trim();
    lines.push(body ? message.content : '_（无正文）_', '');

    const images = renderImageSlots(message, index, expired);
    if (images.length > 0) lines.push(`图片：${images.join(' ')}`, '');

    if (message.ocrTexts && message.ocrTexts.length > 0) {
      // 与气泡徽章同口径（doc/browser-local-ocr.md §6.2）：按发送时刻引擎区分去向，
      // 无引擎字段的旧消息中性兜底，不写死「本地」（云端引擎下原表述失真）
      const ocrLine =
        message.ocrEngine === 'cloud'
          ? `云端 OCR 产物：${message.ocrTexts.length} 张（图片像素已外发至云端 OCR 服务）`
          : message.ocrEngine === 'local'
            ? `本地 OCR 产物：${message.ocrTexts.length} 张（原图未上行）`
            : `OCR 产物：${message.ocrTexts.length} 张`;
      lines.push(`- ${ocrLine}`);
    }

    const files = renderFiles(message);
    if (files.length > 0) lines.push(...files);

    const tools = renderToolCalls(message);
    if (tools.length > 0) lines.push('', '工具调用：', ...tools);

    if (message.diagnosis) {
      lines.push(
        '',
        `诊断结果：${message.diagnosis.level} · ${message.diagnosis.knowledgePoints.length} 个知识点`
      );
    }

    lines.push('', '---', '');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

/** 文件名里的非法字符替换成 `-`：Windows 落盘不接受 `\ / : * ? " < > |` */
export function sanitizeFileStem(raw: string, maxChars = 30): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return truncateByCodePoint(cleaned, maxChars) || 'session';
}

/** `notesync-<标题>-<yyyyMMdd-HHmm>.md` */
export function buildSessionFileName(meta: SessionMeta, now: number): string {
  const date = new Date(now);
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(
    date.getHours()
  )}${pad2(date.getMinutes())}`;
  return `notesync-${sanitizeFileStem(meta.title || UNTITLED_SESSION)}-${stamp}.md`;
}

/** 触发浏览器下载；SSR 环境静默跳过 */
export function downloadMarkdown(fileName: string, content: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * 按库里已落盘快照导出某个会话。
 * 读不到（会话已删/记录损坏）返回 false，由调用方决定提示；
 * 不读内存态：侧栏没有 messages，也不该为此新增跨组件读取通道（§8.2）。
 */
export async function exportSessionMarkdown(meta: SessionMeta): Promise<boolean> {
  const record = await getHistoryStorage().loadSession(meta.id);
  if (!record) return false;
  const now = Date.now();
  downloadMarkdown(
    buildSessionFileName(meta, now),
    buildSessionMarkdown(meta, record.messages, record.expiredImages)
  );
  return true;
}
