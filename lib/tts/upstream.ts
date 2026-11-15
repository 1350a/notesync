/**
 * TTS 上游请求共用出口（doc/tts.md §2/§6）：两家引擎的 fetch + 错误归一。
 * 密钥只在此层拼 Bearer 头，不出 lib/tts（AGENTS.md §7）；错误响应原文经
 * redact 脱敏取摘要（与 chat/ocr 同口径），音频二进制原样返回。
 */
import { extractUpstreamMessage, redactUpstreamText } from '../safety/redact.ts';
import { TtsError } from './errors.ts';

/** 单段合成超时：单段 ≤ 数千字符，合成通常秒级；60s 与 OCR 链路对齐 */
const REQUEST_TIMEOUT_MS = 60_000;

export async function postAudioRequest(opts: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  /** 错误文案里的引擎标识（如「智谱 TTS」） */
  label: string;
}): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(opts.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new TtsError('provider_error', `无法连接${opts.label}端点：${reason}`);
  }

  const payload = await res.arrayBuffer();
  if (!res.ok) throw upstreamError(res.status, payload, opts.label);
  // 上游/网关偶发以 200 + JSON 回错误：content-type 非音频按失败处理，防把错误体当音频播
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('audio')) {
    throw upstreamError(res.status, payload, opts.label);
  }
  return payload;
}

/** 上游错误归一：429 单列 rate_limited，其余 provider_error；摘要脱敏不贴原文 */
function upstreamError(status: number, payload: ArrayBuffer, label: string): TtsError {
  const raw = new TextDecoder().decode(payload.slice(0, 2048));
  const summary = redactUpstreamText(extractUpstreamMessage(raw));
  const code = status === 429 ? 'rate_limited' : 'provider_error';
  const prefix =
    status === 429
      ? `${label}并发/频率受限（HTTP 429），请稍后再试`
      : `${label}上游错误（HTTP ${status}）`;
  return new TtsError(code, summary ? `${prefix}：${summary}` : prefix);
}
