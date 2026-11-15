/**
 * .doc 服务端解析客户端（doc/file-intake.md §8）
 *
 * 旧版 Word 是 OLE 二进制，浏览器端无解，内容会上传至**自有服务端**解析——
 * 调用方 UI 必须明示这一点（AGENTS.md §8 接线诚实）。
 */
import { readAsDataUrl } from './extract-image.ts';

export type ParseDocResult = { ok: true; text: string } | { ok: false; reason: string };

/** 从 { error, message } / { text } 两种响应形态里安全取 message */
function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const message = (body as Record<string, unknown>).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

export async function parseDocViaServer(file: File): Promise<ParseDocResult> {
  let dataUrl: string;
  try {
    dataUrl = await readAsDataUrl(file);
  } catch {
    return { ok: false, reason: '读取文件失败，请重试' };
  }

  let res: Response;
  try {
    res = await fetch('/api/parse-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, name: file.name }),
    });
  } catch {
    return { ok: false, reason: '网络请求失败，请重试' };
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, reason: messageOf(body, `请求失败（HTTP ${res.status}）`) };
  }
  const text =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).text
      : undefined;
  if (typeof text !== 'string') {
    return { ok: false, reason: '服务端返回异常，未取到解析文本' };
  }
  return { ok: true, text };
}
