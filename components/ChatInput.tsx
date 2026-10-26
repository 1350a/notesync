"use client";

import { useRef, useState } from "react";
import type { Attachment, OllamaModel } from "@/lib/types";

interface ChatInputProps {
  models: OllamaModel[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  onSend: (content: string, attachments: Attachment[]) => void;
  disabled?: boolean;
}

/** 读取文件为 Data URL（图片直接预览，PDF 记录文件名） */
function readFileAsDataUrl(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        dataUrl: typeof reader.result === "string" ? reader.result : undefined,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 底部输入区：纯文字粘贴输入 + 图片/PDF 附件上传 + 模型选择 + 发送按钮。
 * 颜色全部引用主题 CSS 变量，随主题全局同步。
 */
export default function ChatInput({
  models,
  selectedModel,
  onModelChange,
  onSend,
  disabled = false,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/") || file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        try {
          list.push(await readFileAsDataUrl(file));
        } catch {
          // 忽略读取失败的文件
        }
      }
    }
    if (list.length > 0) {
      setAttachments((prev) => [...prev, ...list]);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files as unknown as FileList);
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = () => {
    const content = text.trim();
    if (!content && attachments.length === 0) return;
    if (disabled) return;
    onSend(content, attachments);
    setText("");
    setAttachments([]);
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-deep)] p-3">
      {/* 附件预览区 */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="relative flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] px-2 py-1.5 text-xs text-[var(--text-secondary)]"
            >
              {att.type.startsWith("image/") && att.dataUrl ? (
                <img src={att.dataUrl} alt={att.name} className="h-8 w-8 rounded-md object-cover" />
              ) : (
                <span className="text-sm">📄</span>
              )}
              <span className="max-w-40 truncate">{att.name}</span>
              <button
                onClick={() => removeAttachment(i)}
                title="移除附件"
                className="ml-1 rounded-md p-0.5 text-[var(--text-muted)] transition hover:bg-red-500/20 hover:text-red-400"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* 附件上传按钮 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          title="上传错题图片/PDF"
          className="rounded-xl bg-[var(--panel-soft)] p-2.5 text-[var(--text-secondary)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {/* 文本输入区 */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="粘贴或输入你的错题内容，按 Enter 发送，Shift+Enter 换行…"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] px-3 py-2.5 text-sm text-[var(--text)] placeholder-[var(--text-muted)] outline-none transition focus:border-[var(--accent)] focus:bg-[var(--hover)]"
        />

        {/* 发送按钮 */}
        <button
          onClick={submit}
          disabled={disabled || (!text.trim() && attachments.length === 0)}
          title="发送"
          className="rounded-xl bg-[var(--accent)] p-2.5 text-[var(--accent-text)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </div>

      {/* 模型选择行 */}
      <div className="mt-2 flex items-center gap-2 px-1">
        <label className="text-xs text-[var(--text-muted)]">模型：</label>
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-2 py-1 text-xs text-[var(--text-secondary)] outline-none transition focus:border-[var(--accent)]"
        >
          {models.length === 0 && <option value="">（未检测到模型）</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">支持粘贴文字 / 上传图片 / PDF</span>
      </div>
    </div>
  );
}
