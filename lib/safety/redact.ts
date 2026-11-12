/**
 * 上游错误原文脱敏（对应审查项 S2）。
 *
 * 上游 4xx/5xx 的响应体常带 request_id、trace id、账号邮箱、密钥片段与内部字段名。
 * 此前这些内容被原样拼进 error 事件下发到浏览器——实测真实 402 响应里就带
 * `request_id`（见 doc/chat-history.md 的排错记录）。
 *
 * 这里保留可诊断的部分（错误语义、状态码、关键短语），抹掉能定位到具体账号或
 * 具体请求的标识，并截断长度；完整原文仍然进服务端日志（console.error），
 * 排错能力不受影响。
 */

/** 摘要字符上限：够放下「Insufficient Balance」这类短语义，又不至于把响应体整段带出 */
export const MAX_ERROR_SUMMARY_CHARS = 200;

/**
 * 抹掉可定位标识 + 压平空白 + 截断。
 *
 * 顺序有讲究：先按模式替换，最后再 slice——先截断会把 UUID / 邮箱切断，
 * 导致后续正则认不出来。
 */
export function redactUpstreamText(text: string): string {
  if (!text) return '';
  return text
    // UUID：request_id / trace id 最常见形态
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    // 键值对形态的追踪标识（request_id: xxx / traceId=xxx）
    .replace(
      /\b(request_?id|trace_?id|req_?id|rid|session_?id)\b\s*[:=]\s*["']?[\w.-]{6,}["']?/gi,
      '$1=[id]',
    )
    // 邮箱：直接指向账号
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    // 密钥形态（sk-xxxx / ak-xxxx）
    .replace(/\b(?:sk|ak|pk)-[A-Za-z0-9_-]{8,}/g, '[key]')
    // 长 hex / 疑似签名或令牌
    .replace(/\b[0-9a-f]{32,}\b/gi, '[token]')
    // 压平换行与多余空白，避免摘要里混进大段 JSON
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_SUMMARY_CHARS);
}

/**
 * 从上游响应体里只取「语义」那一句，再交给 {@link redactUpstreamText} 脱敏。
 *
 * 直接把整段 JSON 塞进摘要会把 `type` / `param` / `code` 等上游内部字段一并
 * 暴露到浏览器，其中的 `code` 还容易和本地 `error.code` 混淆。这里按常见形态
 * 取 message 文本（`error.message` / `error` 字符串 / 顶层 `message` / `msg`），
 * 解析不了（网关返回 HTML 或纯文本）就退回原文，语义不丢。
 */
export function extractUpstreamMessage(raw: string): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  try {
    const parsed: unknown = JSON.parse(text);
    const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    if (record) {
      const error = record.error;
      if (typeof error === 'string' && error.trim()) return error.trim();
      if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string' && message.trim()) return message.trim();
      }
      if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
      if (typeof record.msg === 'string' && record.msg.trim()) return record.msg.trim();
    }
  } catch {
    // 非 JSON：原文继续走脱敏流程
  }
  return text;
}

/** 日志侧最多留存的原文长度：够定位问题，又不至于把整段响应体写进日志 */
export const MAX_ERROR_LOG_CHARS = 2000;
