/**
 * DeepSeek safety_check 全链路 E2E（safety-protocol.md §3.2）
 *
 * 进程内假上游替代真实 api.deepseek.com，直接调 POST /api/chat（不经前端 hooks），
 * 一次验死三件事：
 * 1. 开关→请求体：DEEPSEEK_SAFETY_CHECK=high 时上游请求体必带 safety_check（硬证据）；
 * 2. 输入未过审 400 Content Exists Risk → SSE error 事件 code=content_blocked
 *    signal=upstream_400（实弹发现：DeepSeek 对自伤/爆炸物类输入并不 400 而是放行给
 *    模型自拒答，故真实触发样例不可得——400 行为用假上游确定性锁定）；
 * 3. 流式拒答（finish_reason=content_filter + delta.refusal）→ 同归一为 content_blocked，
 *    signal=finish_reason、refusal 透传，且已流出的 content 事件照常下发（前端负责丢弃展示）。
 * 默认关闭态不发 safety_check 字段（行为与更新前一致）也一并锁定。
 *
 * provider 单例在模块加载时读 env：每个用例组先 stubEnv + resetModules 再动态 import
 * 路由（registry 等模块态随 resetModules 一并重建，重复注册不会冲突）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { CONTENT_BLOCKED_MESSAGE } from '@/lib/safety/messages';

/** 假上游记录到的 /chat/completions 请求体（取判定相关字段） */
interface RecordedBody {
  safety_check?: { level?: string };
  messages?: unknown[];
  stream?: boolean;
}

let server: Server;
let baseUrl = '';
const received: RecordedBody[] = [];

/** SSE 文本 → 事件数组（与前端 parseSseEvent 同口径） */
function parseSse(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const chunk of text.split('\n\n')) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0 && event !== 'message') {
      out.push({ event, data: JSON.parse(dataLines.join('\n')) });
    }
  }
  return out;
}

/** 起假上游：/models 回枚举；/chat/completions 按标记分流 400 或流式拒答 */
function startFakeUpstream(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: string) => (raw += c));
      req.on('end', () => {
        if ((req.url ?? '').includes('/models')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }));
          return;
        }
        let body: RecordedBody = {};
        try {
          body = JSON.parse(raw) as RecordedBody;
        } catch {
          // 非法 JSON：仍按 400 分支处理
        }
        received.push(body);
        const text = JSON.stringify(body.messages ?? []);
        if (text.includes('__STREAM_BLOCK__')) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          const chunk = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
          chunk({ choices: [{ delta: { role: 'assistant', content: '这段文本已流出，' } }] });
          chunk({ choices: [{ delta: { content: '随后响应以拒答结束。' } }] });
          chunk({
            choices: [
              {
                delta: { refusal: 'The following images were blocked: img-001' },
                finish_reason: 'content_filter',
              },
            ],
          });
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: 'Content Exists Risk: input failed moderation (fake upstream)',
              type: 'invalid_request_error',
            },
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

/** 每个 describe 独立装配：stub env → 重置模块 → 动态 import 路由（单例读到本次 env） */
async function loadRoute(): Promise<void> {
  vi.stubEnv('DEEPSEEK_API_KEY', 'fake-key-e2e');
  vi.stubEnv('DEEPSEEK_BASE_URL', baseUrl);
  vi.stubEnv('ZHIPU_API_KEY', '');
  vi.stubEnv('CUSTOM_API_KEY', '');
  vi.stubEnv('CUSTOM_BASE_URL', '');
  vi.stubEnv('MOCK_MODEL', '');
  vi.resetModules();
  return import('@/app/api/chat/route').then((m) => {
    POST = m.POST;
  });
}

let POST: typeof import('@/app/api/chat/route').POST;

async function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  await startFakeUpstream();
});

afterAll(() => {
  vi.unstubAllEnvs();
  server.close();
});

describe('safety_check=high（开启态全链路）', () => {
  beforeAll(async () => {
    vi.stubEnv('DEEPSEEK_SAFETY_CHECK', 'high');
    await loadRoute();
  });

  it('请求体必带 safety_check；输入 400 Content Exists Risk 归一 content_blocked/upstream_400', async () => {
    const before = received.length;
    const res = await post({ content: '解方程 x + 1 = 2。', model: 'deepseek-flash' });
    const events = parseSse(await res.text());

    // 硬证据：发给上游的每个请求体都带 high（含 probe 的 /models 之外的补全请求）
    const sent = received.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    for (const body of sent) {
      expect(body.safety_check).toEqual({ level: 'high' });
    }

    const errs = events.filter((e) => e.event === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]!.data).toMatchObject({
      code: 'content_blocked',
      signal: 'upstream_400',
      provider: 'deepseek',
    });
    expect(errs[0]!.data.error).toBe(CONTENT_BLOCKED_MESSAGE);
    // 拦截即终止：不发 done（§3.1，本轮历史已回滚）
    expect(events.some((e) => e.event === 'done')).toBe(false);
    expect(events.some((e) => e.event === 'content')).toBe(false);
  }, 20_000);

  it('流式拒答：content 先流出，随后 content_blocked/finish_reason + refusal 透传', async () => {
    const res = await post({
      content: '__STREAM_BLOCK__ 解方程 x + 1 = 2。',
      model: 'deepseek-flash',
    });
    const events = parseSse(await res.text());

    // 已流出的文本照常下发（官方要求前端删除已展示内容，丢弃动作在 useChat）
    const contents = events.filter((e) => e.event === 'content');
    expect(contents.length).toBeGreaterThan(0);

    const errs = events.filter((e) => e.event === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]!.data).toMatchObject({
      code: 'content_blocked',
      signal: 'finish_reason',
      finishReason: 'content_filter',
      provider: 'deepseek',
    });
    expect(String(errs[0]!.data.refusal)).toContain('blocked');
    expect(events.some((e) => e.event === 'done')).toBe(false);
  }, 20_000);
});

describe('safety_check 未配置（默认关闭态）', () => {
  beforeAll(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('DEEPSEEK_API_KEY', 'fake-key-e2e');
    vi.stubEnv('DEEPSEEK_BASE_URL', baseUrl);
    vi.stubEnv('ZHIPU_API_KEY', '');
    vi.stubEnv('CUSTOM_API_KEY', '');
    vi.stubEnv('CUSTOM_BASE_URL', '');
    vi.stubEnv('MOCK_MODEL', '');
    delete process.env.DEEPSEEK_SAFETY_CHECK;
    vi.resetModules();
    await import('@/app/api/chat/route').then((m) => {
      POST = m.POST;
    });
  });

  it('请求体不带 safety_check 字段；上游 400 仍归一拦截链路（与开关无关）', async () => {
    const before = received.length;
    const res = await post({ content: '解方程 x + 1 = 2。', model: 'deepseek-flash' });
    const events = parseSse(await res.text());

    const sent = received.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    for (const body of sent) {
      expect(body.safety_check).toBeUndefined();
    }

    const errs = events.filter((e) => e.event === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]!.data).toMatchObject({ code: 'content_blocked', signal: 'upstream_400' });
  }, 20_000);
});
