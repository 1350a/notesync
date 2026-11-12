'use client';

import { useState } from 'react';

/**
 * 消息气泡操作条（doc/chat-history.md §8.3）。
 *
 * 交互口径：桌面端 hover / 键盘聚焦才显示，触屏常显（`touch:` 变体，同 doc/mobile-ux.md §4）。
 * 「复制」仍由 ChatList 里既有的 CopyButton 承担，这里只管会改变数据的操作，
 * 避免两套复制按钮并存。
 */
export interface MessageActionsProps {
  role: 'user' | 'assistant';
  /** 仅最后一条 assistant 可重新生成：历史中间位置重生成没有语义 */
  canRegenerate: boolean;
  /** 生成中禁用：此时改历史会让流式写入落到错位的消息上 */
  disabled: boolean;
  onEdit?: () => void;
  onRegenerate?: () => void;
  onDelete: () => void;
}

function ActionButton({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-2 py-1 text-[11px] transition-colors touch:h-9 touch:px-3 disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        border: '1px solid var(--border)',
        color: danger ? 'var(--danger, #dc2626)' : 'var(--text-muted)',
      }}
      title={disabled ? '生成中不可操作' : label}
    >
      {label}
    </button>
  );
}

export default function MessageActions({
  role,
  canRegenerate,
  disabled,
  onEdit,
  onRegenerate,
  onDelete,
}: MessageActionsProps) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100 opacity-0">
      {role === 'user' && onEdit ? (
        <ActionButton label="编辑" onClick={onEdit} disabled={disabled} />
      ) : null}
      {role === 'assistant' && canRegenerate && onRegenerate ? (
        <ActionButton label="重新生成" onClick={onRegenerate} disabled={disabled} />
      ) : null}
      <ActionButton label="删除" onClick={onDelete} disabled={disabled} danger />
    </div>
  );
}

/**
 * 就地编辑框：只改正文，附件沿用原条（附件重传要重新读文件，不属于"改个字"的成本）。
 * Ctrl/Cmd+Enter 提交、Esc 取消——回车提交会让多行正文没法换行。
 */
export function MessageEditor({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const tooLong = value.length > 200_000;
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        autoFocus
        rows={Math.min(10, Math.max(2, value.split('\n').length))}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (value.trim() && !tooLong) onSubmit(value);
          }
        }}
        className="w-full resize-y rounded-lg px-3 py-2 text-sm outline-none"
        style={{
          border: '1px solid var(--border)',
          backgroundColor: 'var(--bg-deep)',
          color: 'var(--text)',
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSubmit(value)}
          disabled={!value.trim() || tooLong}
          className="rounded-md px-2 py-1 text-[11px] disabled:opacity-40 touch:h-9 touch:px-3"
          style={{ border: '1px solid var(--border)', color: 'var(--accent)' }}
        >
          保存并重发
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[11px] touch:h-9 touch:px-3"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          取消
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Ctrl/Cmd+Enter 提交，Esc 取消
        </span>
      </div>
    </div>
  );
}
