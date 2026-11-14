'use client';

import { useState } from 'react';

/**
 * 消息操作条（doc/chat-history.md §8.3）。
 *
 * 2026-11-14 改版：操作条放在气泡外、正文下方，按钮从文字改为图标，一行排列；
 * 删除入口已下线（用户要求，见 §8.3 表格）。复制从 ChatList 收编到这里，
 * 避免两套复制按钮并存。交互口径不变：桌面端 hover / 键盘聚焦才显示，
 * 触屏常显（`touch:` 变体，同 doc/mobile-ux.md §4）。
 *
 * 图标用内联 SVG（feather 线条风格），与 ChatInput 既有图标同一画法
 * （fill=none + stroke=currentColor + 24 viewBox）；不引图标库，零新增依赖。
 */

/** 图标按钮通用样式：触发面积 28px（触屏 36px），图标本体只有 14px */
const ICON_BUTTON_CLASS =
  'flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 touch:h-9 touch:w-9';

function CopyIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <polyline points="23 4 23 10 17 10" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      <polyline points="1 20 1 14 7 14" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

/** 复制按钮：复制消息的原始 markdown 源文本——渲染后 DOM 复制会把 KaTeX/表格拷成碎片，
 * 源文本才是可再用的形态。成功反馈换勾图标 1.5s；剪贴板不可用时静默失败（纯增益不弹错）。 */
function CopyAction({ text, disabled }: { text: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 非安全上下文等场景静默失败：复制是纯增益，不弹错误打断对话
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled}
      className={ICON_BUTTON_CLASS}
      style={{ color: copied ? 'var(--primary)' : 'var(--text-muted)' }}
      title="复制 Markdown 源文本"
      aria-label="复制"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function EditAction({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={ICON_BUTTON_CLASS}
      style={{ color: 'var(--text-muted)' }}
      title="编辑并重发"
      aria-label="编辑"
    >
      <EditIcon />
    </button>
  );
}

function RegenerateAction({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={ICON_BUTTON_CLASS}
      style={{ color: 'var(--text-muted)' }}
      title="重新生成"
      aria-label="重新生成"
    >
      <RegenerateIcon />
    </button>
  );
}

export interface MessageActionsProps {
  role: 'user' | 'assistant';
  /** 仅最后一条 assistant 可重新生成：历史中间位置重生成没有语义 */
  canRegenerate: boolean;
  /** 生成中禁用：此时改历史会让流式写入落到错位的消息上 */
  disabled: boolean;
  /** 复制用的 markdown 源文本；缺省（无正文/纯附件消息）不渲染复制按钮 */
  copyText?: string;
  onEdit?: () => void;
  onRegenerate?: () => void;
}

export default function MessageActions({
  role,
  canRegenerate,
  disabled,
  copyText,
  onEdit,
  onRegenerate,
}: MessageActionsProps) {
  return (
    <div className="mt-1 flex items-center gap-0.5 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100 opacity-0">
      {copyText ? <CopyAction text={copyText} disabled={disabled} /> : null}
      {role === 'user' && onEdit ? <EditAction onClick={onEdit} disabled={disabled} /> : null}
      {role === 'assistant' && canRegenerate && onRegenerate ? (
        <RegenerateAction onClick={onRegenerate} disabled={disabled} />
      ) : null}
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
          style={{ border: '1px solid var(--border)', color: 'var(--primary)' }}
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
