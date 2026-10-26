"use client";

import type { Message } from "@/lib/types";

interface ChatMessageProps {
  message: Message;
}

/** 渲染图片/PDF 附件预览 */
function AttachmentPreview({ name, type, dataUrl }: { name: string; type: string; dataUrl?: string }) {
  if (type.startsWith("image/") && dataUrl) {
    return (
      <img
        src={dataUrl}
        alt={name}
        className="mb-2 max-h-52 max-w-full rounded-xl border border-white/10 object-contain"
      />
    );
  }
  if (type === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
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
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
      <span className="truncate">📎 {name}</span>
    </div>
  );
}

/**
 * 消息气泡：用户消息（右侧）与 AI 回复（左侧），支持附件预览。
 */
export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-lg ${
          isUser
            ? "rounded-br-md bg-indigo-600 text-white"
            : "rounded-bl-md bg-zinc-800/90 text-zinc-100 border border-white/10"
        }`}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className={message.content ? "mb-2" : ""}>
            {message.attachments.map((att, i) => (
              <AttachmentPreview key={i} {...att} />
            ))}
          </div>
        )}
        {message.content ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.content}
          </p>
        ) : (
          !message.attachments?.length && (
            <p className="text-sm text-zinc-400 italic">（空消息）</p>
          )
        )}
        {message.model && !isUser && (
          <p className="mt-1 text-right text-[10px] text-zinc-500">{message.model}</p>
        )}
      </div>
    </div>
  );
}
