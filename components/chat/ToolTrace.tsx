'use client';
import { useState } from 'react';
import type { ToolCallView } from '@/lib/chat/messages';

/**
 * assistant 气泡内的工具调用轨迹：每次调用一行（名称 · 状态 · 耗时），
 * 可展开查看参数与结果摘要。tool_result 未回填时显示"运行中"，
 * ask_user 例外——中断语义没有 tool_result 事件，显示"等待回答"。
 */
export default function ToolTrace({ calls }: { calls: ToolCallView[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 0) return null;

  return (
    <div
      className="mb-2 rounded-xl px-3 py-2"
      style={{ border: '1px solid var(--border)', backgroundColor: 'var(--panel-soft)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium outline-none"
        style={{ color: 'var(--text-muted)' }}
      >
        {open ? '▾' : '▸'} 工具调用（{calls.length}）
      </button>
      <div className="mt-1 space-y-0.5">
        {calls.map((call) => (
          <div
            key={call.id}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span aria-hidden>🔧</span>
            <span className="font-mono">{call.name}</span>
            {call.result ? (
              <>
                <span style={{ color: call.result.ok ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                  {call.result.ok ? '✓ 完成' : '✗ 失败'}
                </span>
                {call.result.ms > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>{call.result.ms}ms</span>
                )}
              </>
            ) : call.name === 'ask_user' ? (
              // ask_user 无 tool_result 事件，用稳定的等待文案代替闪烁的"运行中"
              <span style={{ color: 'var(--muted-foreground)' }}>等待回答</span>
            ) : (
              <span className="animate-pulse" style={{ color: 'var(--accent)' }}>
                运行中…
              </span>
            )}
          </div>
        ))}
      </div>
      {open && (
        <pre
          className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          {calls
            .map((call) =>
              JSON.stringify(
                {
                  name: call.name,
                  arguments: call.arguments,
                  result: call.result ? { ok: call.result.ok, summary: call.result.summary } : undefined,
                },
                null,
                2
              )
            )
            .join('\n---\n')}
        </pre>
      )}
    </div>
  );
}
