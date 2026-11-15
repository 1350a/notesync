/**
 * 整卷诊断「切题取材」回归用例（非 MOCK：注入假 Provider，命中真实编排分支）
 *
 * 覆盖三件事：
 * 1. 切题消息必须携带图片本体（此前拍平成「[图片]」占位，原图直传档模型只看到占位 → 必失败）；
 * 2. 模型不收图且附件无 OCR 文本时，前置返回 no_text_material，不空打上游；
 * 3. 切题失败按原因分层出文案，并在服务端留痕（原因 + 脱敏原文）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({
  acceptImages: { value: true },
  completeDetailed: vi.fn(),
}));

vi.mock('@/lib/provider', () => ({
  getModelList: async () => ({ models: [{ name: 'fake-vision' }], available: true, status: 'ok' }),
  resolveProvider: () => ({
    model: 'fake-vision',
    provider: {
      name: 'fake',
      displayName: '假 Provider',
      isAvailable: () => true,
      acceptsImages: true,
      modelAcceptsImages: () => stub.acceptImages.value,
      complete: async () => '',
      completeDetailed: stub.completeDetailed,
      listModels: async () => [],
      probe: async () => ({ status: 'ok', models: [] }),
      ownsModel: () => true,
    },
  }),
}));

import { POST } from '@/app/api/diagnose-paper/route';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

async function readSse(res: Response): Promise<SseEvent[]> {
  const text = await res.text();
  const events: SseEvent[] = [];
  for (const chunk of text.split('\n\n')) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    events.push({ event, data: JSON.parse(dataLines.join('\n')) });
  }
  return events;
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/diagnose-paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('MOCK_MODEL', '');
  stub.acceptImages.value = true;
  stub.completeDetailed.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('整卷诊断切题取材（真实编排分支）', () => {
  it('切题消息携带图片本体，切题可正常推进（回归：不再拍平成占位文本）', async () => {
    stub.completeDetailed
      .mockResolvedValueOnce({ content: '[{"number":"1","stem":"解方程 x+1=2"}]', finishReason: 'stop' })
      .mockResolvedValue({ content: '不是 JSON', finishReason: 'stop' });

    const events = await readSse(
      await post({ attachments: [{ name: '卷.jpg', category: 'origin', dataUrl: 'data:image/jpeg;base64,AAAA' }] }),
    );

    const firstCall = stub.completeDetailed.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const userMessage = firstCall.messages[firstCall.messages.length - 1];
    expect(Array.isArray(userMessage.content)).toBe(true);
    const parts = userMessage.content as Array<{ type: string }>;
    expect(parts.some((part) => part.type === 'image_url')).toBe(true);
    expect(events.some((e) => e.event === 'paper_step' && String(e.data.step).includes('切题完成：1 题'))).toBe(
      true,
    );
    expect(events.some((e) => e.event === 'error' && e.data.code === 'provider_error')).toBe(false);
  });

  it('模型不收图且无 OCR 文本：前置返回 no_text_material，不空打上游', async () => {
    stub.acceptImages.value = false;

    const events = await readSse(
      await post({ attachments: [{ name: '卷.jpg', category: 'origin', dataUrl: 'data:image/jpeg;base64,AAAA' }] }),
    );

    const error = events.find((e) => e.event === 'error');
    expect(error?.data.code).toBe('no_text_material');
    expect(stub.completeDetailed).not.toHaveBeenCalled();
    expect(events.some((e) => e.event === 'done')).toBe(false);
  });

  it('切题返回空数组：按 empty 原因出文案并留痕，不再笼统说「拍照模糊」', async () => {
    stub.completeDetailed.mockResolvedValue({ content: '[]', finishReason: 'stop' });

    const events = await readSse(
      await post({ attachments: [{ name: '卷.txt', category: 'origin', text: '第一题 解方程' }] }),
    );

    const error = events.find((e) => e.event === 'error');
    expect(error?.data.code).toBe('provider_error');
    expect(String(error?.data.error)).toContain('没有从材料中切出任何题目');
    expect(String(error?.data.error)).not.toContain('拍照模糊');
    const warnCalls = warnSpy.mock.calls as unknown[][];
    expect(warnCalls.some((call) => String(call[0]).includes('切题失败 reason=empty'))).toBe(true);
  });
});
