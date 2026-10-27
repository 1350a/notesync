"use client";

import type { Message } from "@/lib/types";

interface ChatMessageProps {
  message: Message;
  /** 点击"回答此问题"时的回调（harness 追问阶段问题） */
  onAnswer?: (question: string) => void;
}

/** 渲染图片/PDF 附件预览 */
function AttachmentPreview({ name, type, dataUrl }: { name: string; type: string; dataUrl?: string }) {
  if (type.startsWith("image/") && dataUrl) {
    return (
      <img
        src={dataUrl}
        alt={name}
        className="mb-2 max-h-52 max-w-full rounded-xl border border-[var(--border)] object-contain"
      />
    );
  }
  if (type === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] px-3 py-2 text-sm text-[var(--text-secondary)]">
        <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
        <span className="truncate">{name}</span>
      </div>
    );
  }
  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] px-3 py-2 text-sm text-[var(--text-secondary)]">
      <span className="truncate">📎 {name}</span>
    </div>
  );
}

/** 追问阶段：渲染待回答的问题列表 + 回答按钮 */
function QuestionCard({ questions, onAnswer }: { questions: string[]; onAnswer?: (q: string) => void }) {
  return (
    <div className="mb-2 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] p-3">
      <p className="mb-1.5 text-xs font-semibold text-[var(--accent)]">
        需要补充信息，请回答以下问题：
      </p>
      <ul className="space-y-1.5">
        {questions.map((q, i) => (
          <li key={i} className="flex items-start justify-between gap-2 text-sm">
            <span className="flex-1 text-[var(--text-secondary)]">
              {i + 1}. {q}
            </span>
            {onAnswer && (
              <button
                onClick={() => onAnswer(q)}
                className="shrink-0 rounded-lg border border-[var(--accent)] px-2 py-0.5 text-xs text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-[var(--accent-text)]"
              >
                回答此问题
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 消息气泡：用户消息（右侧）与 AI 回复（左侧），支持附件预览。
 * harness 追问阶段（phase=question）额外展示待回答的问题列表。
 * 颜色全部引用主题 CSS 变量，随主题全局同步。
 */
export default function ChatMessage({ message, onAnswer }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isQuestion =
    message.phase === "question" &&
    Array.isArray(message.questions) &&
    message.questions.length > 0;

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-lg ${
          isUser
            ? "rounded-br-md bg-[var(--accent)] text-[var(--accent-text)]"
            : "rounded-bl-md border border-[var(--border)] bg-[var(--ai-bubble)] text-[var(--text)]"
        }`}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className={message.content ? "mb-2" : ""}>
            {message.attachments.map((att, i) => (
              <AttachmentPreview key={i} {...att} />
            ))}
          </div>
        )}
        {isQuestion && <QuestionCard questions={message.questions ?? []} onAnswer={onAnswer} />}
        {message.content ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.content}
          </p>
        ) : (
          !message.attachments?.length && !isQuestion && (
            <p className="text-sm text-[var(--text-muted)] italic">（空消息）</p>
          )
        )}
        {message.model && !isUser && (
          <p className="mt-1 text-right text-[10px] text-[var(--text-muted)]">{message.model}</p>
        )}
      </div>
    </div>
  );
}
