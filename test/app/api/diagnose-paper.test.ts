/**
 * 整卷诊断四步流程端到端用例（MOCK 剧本，零 token）：
 * 直接调 route.ts 的 POST 断言 SSE 事件序列——步骤进度、分组卡片、汇总、done.stats。
 */
process.env.MOCK_MODEL = '1';

import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/diagnose-paper/route';
import type { DiagnosisResult } from '@/lib/diagnose/types';

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

describe('整卷诊断四步流程（MOCK 剧本）', () => {
  it('完整链路：步骤进度 + 每组卡片（策略卡注入）+ 汇总 + 统计', async () => {
    const events = await readSse(
      await post({ attachments: [{ name: '卷.txt', category: 'origin', text: '试卷内容' }] }),
    );

    const steps = events.filter((e) => e.event === 'paper_step');
    expect(steps.length).toBeGreaterThanOrEqual(3); // 切题/分类/组诊断/汇总至少三步留痕

    // 进度口径：阶段固定「阶段 i/4」，分组用「第 i/N 组」——两套分母语义不同，且都与上传文件数无关
    const progresses = steps.map((s) => String(s.data.progress ?? ''));
    expect(progresses.every((p) => p.length > 0)).toBe(true);
    expect(progresses).toContain('阶段 1/4');
    expect(progresses).toContain('阶段 4/4');
    expect(progresses.some((p) => /^第 \d+\/\d+ 组$/.test(p))).toBe(true);
    // 不再下发 current/total：分母不会被误读成上传文件数
    expect(steps.every((s) => s.data.current === undefined && s.data.total === undefined)).toBe(true);

    const diagnoses = events.filter((e) => e.event === 'diagnosis');
    expect(diagnoses.length).toBeGreaterThanOrEqual(1);
    for (const d of diagnoses) {
      const result = d.data.result as DiagnosisResult;
      expect(result.level).toBeDefined();
      expect(result.strategy?.errorCode).toBe(result.errorCause?.code ?? null); // 直查注入
      expect(Array.isArray(d.data.questionNumbers)).toBe(true);
    }

    const summary = events.find((e) => e.event === 'content');
    expect(summary).toBeDefined();

    const done = events.find((e) => e.event === 'done')!;
    expect(done.data.finishReason).toBe('paper');
    expect((done.data.stats as { questions: number }).questions).toBeGreaterThan(0);
  });

  it('无附件：no_content 明确报错，不静默继续', async () => {
    const events = await readSse(await post({ attachments: [] }));
    const error = events.find((e) => e.event === 'error')!;
    expect(error.data.code).toBe('no_content');
    expect(events.some((e) => e.event === 'done')).toBe(false);
  });
});
