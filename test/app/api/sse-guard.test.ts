/**
 * SSE 共用封装的契约用例（对应审查项 S1 / L2）。
 *
 * S1：两条流式路由此前直接 `await request.json()`，请求体不是合法 JSON 时抛异常，
 * 由框架兜底成「空 body 的 500」——前端按 SSE 解析收不到任何 error 事件，
 * 等于错误码体系最外层漏一手。改为统一走 lib/sse.ts 的 readJsonBody 后，
 * 任何情况下都必须回一条结构化 error 事件（code=invalid_request）。
 *
 * L2：SSE 头必须带 X-Accel-Buffering: no，否则经 Nginx 等反代时响应被缓冲，
 * 增量会被攒到最后一次性吐出。
 */
import { describe, expect, it } from 'vitest';
import { POST as chatPOST } from '@/app/api/chat/route';
import { POST as paperPOST } from '@/app/api/diagnose-paper/route';
import { readJsonBody, SSE_HEADERS, sse } from '@/lib/sse';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const chunk of text.split('\n\n')) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    events.push({ event, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> });
  }
  return events;
}

/** 构造一个「体不是合法 JSON」的 POST 请求 */
function badJsonRequest(url: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': 'unit-test' },
    body: '{ "model": "deepseek-v4-flash", ',
  });
}

describe('lib/sse 契约', () => {
  it('SSE_HEADERS 禁止反代缓冲', () => {
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no');
    expect(SSE_HEADERS['Content-Type']).toContain('text/event-stream');
    expect(SSE_HEADERS['Cache-Control']).toBe('no-cache');
  });

  it('sse() 输出单条事件的完整帧', () => {
    expect(sse('error', { code: 'no_model' })).toBe(
      'event: error\ndata: {"code":"no_model"}\n\n',
    );
  });

  it('readJsonBody 读合法 JSON', async () => {
    const result = await readJsonBody<{ a: number }>(
      new Request('http://localhost/api/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"a":1}',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.a).toBe(1);
  });

  it('readJsonBody 解析失败时返回可直接 return 的 error 流', async () => {
    const result = await readJsonBody(badJsonRequest('http://localhost/api/x'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(200);
    const events = parseSse(await result.response.text());
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data.code).toBe('invalid_request');
    expect(String(events[0].data.error)).toContain('JSON');
  });
});

describe('路由层请求体容错（S1）', () => {
  it('/api/chat 非法 JSON 返回 error 事件而非 500 空响应', async () => {
    const res = await chatPOST(badJsonRequest('http://localhost/api/chat'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const events = parseSse(await res.text());
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data.code).toBe('invalid_request');
  });

  it('/api/diagnose-paper 非法 JSON 返回 error 事件而非 500 空响应', async () => {
    const res = await paperPOST(badJsonRequest('http://localhost/api/diagnose-paper'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const events = parseSse(await res.text());
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data.code).toBe('invalid_request');
  });
});
