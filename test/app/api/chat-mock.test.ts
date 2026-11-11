/**
 * MOCK 诊断仿真端到端用例：直接调 route.ts 的 POST（无 next/* 依赖，Web API 原生可用），
 * 断言 SSE 事件序列——诊断卡片事件、ask_user 中断、done.diagnose.context 的状态推进。
 * 这条链路是用户零 token 验证 UI 的通道，剧本坏了等于验证通道失效。
 */
process.env.MOCK_MODEL = '1';

import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/chat/route';
import type { DiagnoseContext, DiagnosisResult } from '@/lib/diagnose/types';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** 从 Response 流解析 SSE 事件序列 */
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
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const ctx = (partial: Partial<DiagnoseContext>): DiagnoseContext => ({
  subject: 'math',
  state: 'intake',
  clarifyUsed: 0,
  hintLevel: 1,
  ...partial,
});

describe('MOCK 诊断仿真（零 token 走通诊断链路）', () => {
  it('intake：L1 卡片事件 + 推进到 clarify（预扣 1）', async () => {
    const events = await readSse(await post({ content: '这道题不会做', diagnose: {} }));
    const diagnosis = events.find((e) => e.event === 'diagnosis');
    expect(diagnosis).toBeDefined();
    const result = diagnosis!.data.result as DiagnosisResult;
    expect(result.level).toBe('L1');
    expect(result.completeness.hasProblem).toBe(true); // 聊天链路由剧本扮演模型判定
    const done = events.find((e) => e.event === 'done')!;
    const context = done.data.diagnose as { context: DiagnoseContext };
    expect(context.context.state).toBe('clarify');
    expect(context.context.clarifyUsed).toBe(1);
  });

  it('clarify：ask_user 中断（awaiting_user + done），上下文原地', async () => {
    // 回答轮必带用户文本（空内容走 no_content 分支，非真实形态）
    const events = await readSse(await post({ content: 'A 公式记错', diagnose: { context: ctx({ state: 'clarify', clarifyUsed: 1 }) } }));
    const awaiting = events.find((e) => e.event === 'awaiting_user');
    expect(awaiting).toBeDefined();
    expect((awaiting!.data.questions as unknown[]).length).toBeGreaterThan(0);
    const done = events.find((e) => e.event === 'done')!;
    expect(done.data.finishReason).toBe('awaiting_user');
    expect((done.data.diagnose as { context: DiagnoseContext }).context.state).toBe('clarify');
  });

  it('diagnose：L2 卡片（策略卡按 code 注入）+ 推进到 explain L1', async () => {
    const events = await readSse(await post({ content: 'A', diagnose: { context: ctx({ state: 'diagnose', clarifyUsed: 1 }) } }));
    const diagnosis = events.find((e) => e.event === 'diagnosis')!;
    const result = diagnosis.data.result as DiagnosisResult;
    expect(result.level).toBe('L2');
    expect(result.errorCause?.code).toBe('formula_misuse');
    expect(result.strategy?.errorCode).toBe('formula_misuse');
    const done = events.find((e) => e.event === 'done')!;
    const context = (done.data.diagnose as { context: DiagnoseContext }).context;
    expect(context.state).toBe('explain');
    expect(context.hintLevel).toBe(1);
  });

  it('explain + hint_descend：阶梯降到 L2，不产生新卡片', async () => {
    const events = await readSse(
      await post({ content: '继续', diagnose: { context: ctx({ state: 'explain', clarifyUsed: 2 }), event: { type: 'hint_descend' } } }),
    );
    expect(events.some((e) => e.event === 'diagnosis')).toBe(false);
    const done = events.find((e) => e.event === 'done')!;
    const context = (done.data.diagnose as { context: DiagnoseContext }).context;
    expect(context.state).toBe('explain');
    expect(context.hintLevel).toBe(2);
  });

  it('explain + mastered：收尾进 done', async () => {
    const events = await readSse(
      await post({ content: '明白了', diagnose: { context: ctx({ state: 'explain', clarifyUsed: 2, hintLevel: 3 }), event: { type: 'mastered' } } }),
    );
    const done = events.find((e) => e.event === 'done')!;
    expect((done.data.diagnose as { context: DiagnoseContext }).context.state).toBe('done');
  });

  it('非诊断请求不受仿真影响：无 diagnosis 事件、无 diagnose 字段', async () => {
    const events = await readSse(await post({ content: '你好' }));
    expect(events.some((e) => e.event === 'diagnosis')).toBe(false);
    const done = events.find((e) => e.event === 'done')!;
    expect(done.data.diagnose).toBeUndefined();
  });
});
