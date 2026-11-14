/**
 * 两条流式路由（/api/chat、/api/diagnose-paper）共用的 SSE 封装。
 *
 * 为什么抽公共件（此前两处各写一份）：
 * - 响应头必须一致，少一个 X-Accel-Buffering 就会在反代后整段缓冲；
 * - 请求体解析的容错口径必须一致：裸 request.json() 抛异常会退化成框架 500，
 *   而前端按 SSE 解析，收不到任何结构化 error 事件，等于错误码体系最外层漏一手；
 * - clientId 只用于日志追踪，取值口径同样不该两处各写一份。
 */

export const encoder = new TextEncoder();

/**
 * SSE 响应头。
 *
 * X-Accel-Buffering: no —— 禁止 Nginx 等反代缓冲响应。缺该头时增量会被攒到最后
 * 一次性吐出，本地直连无感、上线经反代必现。不认该头的中间件会直接忽略，故可
 * 无条件下发，本地与生产行为一致。
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/**
 * error 事件的 code 取值（前端据此区分提示口径：content_blocked / input_blocked
 * 走专属分支，其余统一按 data.error 正文提示，因此新增 code 不会破坏前端解析）。
 *
 * invalid_request：请求体本身不是合法 JSON。此前该场景直接抛异常变成框架 500，
 * 前端拿到空流、无 error 事件，与其余错误路径的口径不一致。
 * content_blocked：上游拦截（响应形态归一，见 lib/safety/block-detect.ts）。
 * input_blocked：服务端输入兜底拦截（结构/指令形态判定，带 signal/category/reason）。
 */
export type SseErrorCode =
  | 'invalid_request'
  | 'invalid_model'
  | 'unconfigured'
  | 'provider_error'
  | 'no_model'
  | 'no_content'
  | 'content_blocked'
  | 'input_blocked';

/** 封装一条 SSE 事件为字节流 */
export function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 直接返回单条 error 事件的流（用于请求前校验失败） */
export function errorStream(data: {
  code: SseErrorCode;
  error: string;
  model?: string;
  provider?: string;
  available?: string[];
  /** 拦截来源（§3 证据字段）：input_guard = 服务端输入兜底；finish_reason / content = 上游 */
  signal?: 'input_guard' | 'finish_reason' | 'content';
  /** 输入拦截命中类别（structure / injection / hardRisk），供前端打标与日志归因 */
  category?: string;
  reason?: string;
}): Response {
  return new Response(sse('error', data), { headers: SSE_HEADERS });
}

/** clientId 仅用于日志追踪，不参与路由与存储 */
export function readClientId(request: Request): string {
  return request.headers.get('x-client-id') ?? 'anonymous';
}

/**
 * 读请求体并解析 JSON。
 *
 * 解析失败不抛异常，而是返回「可直接 return 的 errorStream 响应」，保证前端在任何
 * 情况下都收到结构化 error 事件，而不是框架兜底的空 500。
 */
export async function readJsonBody<T>(
  request: Request,
  errorText = '请求体不是合法 JSON，请检查请求后重试。',
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: (await request.json()) as T };
  } catch {
    return { ok: false, response: errorStream({ code: 'invalid_request', error: errorText }) };
  }
}
