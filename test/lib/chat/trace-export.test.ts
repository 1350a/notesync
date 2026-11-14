/**
 * trace 导出链路用例（批 3-C）：脱敏只作用于导出副本，原记录保持完整推理。
 */
import { describe, expect, it } from 'vitest';
import type { Trace } from '@/lib/chat/trace';
import { buildTraceExportPayload, redactTraceForExport } from '@/lib/chat/trace';

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    startedAt: '2026-11-14T10:00:00.000Z',
    route: '/api/chat',
    model: 'deepseek',
    userInput: '解 f(x)=x²+1 的最小值',
    events: [
      { ms: 0, event: 'start', data: { note: 'ok' } },
      {
        ms: 12,
        event: 'reasoning',
        data: {
          text: '按 DISCIPLINE_BLOCK，先填 completeness，再调用 submit_diagnosis，hintLevel 取 2。',
        },
      },
    ],
    ...overrides,
  };
}

describe('redactTraceForExport', () => {
  it('导出副本里的内部字段名被抹掉，题面里的 x² 保留', () => {
    const original = makeTrace();
    const copy = redactTraceForExport(original);
    const eventText = (copy.events[1]?.data as { text: string }).text;
    expect(eventText).not.toContain('DISCIPLINE_BLOCK');
    expect(eventText).not.toContain('completeness');
    expect(eventText).not.toContain('submit_diagnosis');
    expect(eventText).not.toContain('hintLevel');
    expect(eventText).toContain('[内部字段]');
    expect(copy.userInput).toContain('x²');
  });

  it('不改动原对象：浏览器内存储仍是完整推理', () => {
    const original = makeTrace();
    const before = JSON.stringify(original);
    redactTraceForExport(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(JSON.stringify(original)).toContain('DISCIPLINE_BLOCK');
  });

  it('结构字段（route / model / startedAt）保持原值，不清空观测面', () => {
    const copy = redactTraceForExport(makeTrace());
    expect(copy.route).toBe('/api/chat');
    expect(copy.model).toBe('deepseek');
    expect(copy.startedAt).toBe('2026-11-14T10:00:00.000Z');
  });

  it('深层嵌套与数组内的字符串同样脱敏', () => {
    const copy = redactTraceForExport(
      makeTrace({
        events: [{ ms: 1, event: 'tool', data: { list: [{ deep: ['completeness=1'] }] } }],
      }),
    );
    const data = copy.events[0]?.data as { list: { deep: string[] }[] };
    expect(data.list[0]?.deep[0]).not.toContain('completeness');
    expect(data.list[0]?.deep[0]).toContain('[内部字段]');
  });
});

describe('buildTraceExportPayload', () => {
  it('产出合法 JSON，且不含内部字段名', () => {
    const payload = buildTraceExportPayload([makeTrace()]);
    expect(() => JSON.parse(payload) as unknown).not.toThrow();
    expect(payload).not.toContain('completeness');
    expect(payload).toContain('x²');
  });

  it('空列表产出空数组，不抛错', () => {
    expect(JSON.parse(buildTraceExportPayload([])) as unknown).toEqual([]);
  });
});
