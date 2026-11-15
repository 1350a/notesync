'use client';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { AskUserQuestion } from '@/lib/tools/types';

/**
 * ask_user 问题面板：模型中断等待回答时替换聊天输入框（doc/tool-protocol.md §6）。
 * 逐题作答（预设选项点选或自由输入），支持跳过与翻页；提交时把全部问答
 * 格式化为纯文本（"1. 【label】question：answer"，跳过记"已跳过"），
 * 走普通消息通道回传，问答上下文随之自带。
 */
export default function AskUserPanel({
  questions,
  onSubmit,
}: {
  questions: AskUserQuestion[];
  /** 提交全部回答（已格式化为纯文本） */
  onSubmit: (text: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [drafts, setDrafts] = useState<string[]>(() => questions.map(() => ''));
  const [skipped, setSkipped] = useState<boolean[]>(() => questions.map(() => false));

  const total = questions.length;
  const current = questions[idx];
  if (!current) return null;
  const isLast = idx === total - 1;
  // 跳过或留白的回答统一记"已跳过"，不发送空答案
  const answerOf = (i: number) => (skipped[i] || !drafts[i].trim() ? '已跳过' : drafts[i].trim());

  const setDraft = (v: string) => setDrafts((prev) => prev.map((d, i) => (i === idx ? v : d)));

  /** 跳过/撤销跳过当前题（单问题场景也要有即时反馈，故做成可见的可切换状态） */
  const toggleSkip = () => {
    setSkipped((prev) => prev.map((s, i) => (i === idx ? !s : s)));
  };

  const submit = () => {
    const text = questions
      .map((q, i) => `${i + 1}. ${q.label ? `【${q.label}】` : ''}${q.question}：${answerOf(i)}`)
      .join('\n');
    onSubmit(text);
  };

  /** 回车推进到下一题（最后一题提交），与主输入框的回车发送习惯一致 */
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (isLast) {
      submit();
    } else {
      setIdx((v) => v + 1);
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex w-full items-center justify-between rounded-2xl border border-border bg-background px-4 py-2.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-muted/40"
      >
        <span>🤔 等待你的操作 · 共 {total} 个问题</span>
        <span aria-hidden>▴</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-background p-3 shadow-sm">
      {/* 头部：分类标题（无则"模型提问"）+ 折叠 */}
      <div className="flex items-center justify-between px-1">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {current.label ?? '模型提问'}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCollapsed(true)}
          title="收起面板（回答会保留）"
        >
          <span aria-hidden>▾</span>
        </Button>
      </div>

      {/* 题干 */}
      <p className="whitespace-pre-wrap break-words px-1 py-1.5 text-sm font-medium">
        {current.question}
      </p>

      {/* 预设选项（可选）：点击即作为草稿，仍可自由编辑 */}
      {current.options && current.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-1">
          {current.options.map((opt) => {
            const selected = drafts[idx] === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setDraft(opt)}
                className={
                  selected
                    ? 'rounded-full border border-foreground bg-foreground px-3 py-1 text-xs text-background'
                    : 'rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-muted'
                }
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {/* 跳过状态即时可见：单问题场景下点「跳过」不再看起来没反应（提交时记"已跳过"） */}
      {skipped[idx] && (
        <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
          已跳过此题——点「撤销跳过」可重新作答
        </p>
      )}

      {/* 自由输入：touch 16px 防 iOS 聚焦强制放大（doc/mobile-ux.md §4） */}
      <input
        value={drafts[idx] ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={skipped[idx] ? '此题已跳过' : '输入你的答案…'}
        disabled={skipped[idx]}
        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 touch:text-base disabled:cursor-not-allowed disabled:opacity-60"
      />

      {/* 底栏：翻页 + 跳过/下一题/提交 */}
      <div className="mt-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={idx === 0}
            onClick={() => setIdx((v) => v - 1)}
            title="上一题"
          >
            <span aria-hidden>‹</span>
          </Button>
          <span className="min-w-8 text-center">
            {idx + 1}/{total}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={isLast}
            onClick={() => setIdx((v) => v + 1)}
            title="下一题"
          >
            <span aria-hidden>›</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggleSkip}>
            {skipped[idx] ? '撤销跳过' : '跳过'}
          </Button>
          {isLast ? (
            <Button
              size="sm"
              className="bg-foreground text-background hover:bg-foreground/90"
              onClick={submit}
            >
              提交
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-foreground text-background hover:bg-foreground/90"
              onClick={() => setIdx((v) => v + 1)}
            >
              下一题
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
