'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { ChatMsg } from '@/lib/chat/messages';
import { rehypeSanitizeMarkdown } from '@/lib/markdown/sanitize';
import type { DiagnoseRequestEvent } from '@/lib/diagnose/types';
import DiagnosisCard from './DiagnosisCard';
import ToolTrace from './ToolTrace';

/**
 * 复制按钮：复制消息的原始 markdown 源文本——渲染后 DOM 复制会把 KaTeX/表格拷成碎片，
 * 源文本才是可再用的形态。触屏常显（hover-only 在触屏不可见，doc/mobile-ux.md §4）。
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非安全上下文等）时静默失败：复制是纯增益，不弹错误打断对话
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="mt-2 rounded-md px-2 py-1 text-[11px] transition-colors touch:h-9 touch:px-3"
      style={{ border: '1px solid var(--border)', color: copied ? 'var(--accent)' : 'var(--text-muted)' }}
      title="复制 Markdown 源文本"
    >
      {copied ? '✓ 已复制' : '复制'}
    </button>
  );
}

function ThinkingBlock({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
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
        {open ? '▾' : '▸'} 思考过程
      </button>
      {open && (
        <pre
          className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          {reasoning}
        </pre>
      )}
    </div>
  );
}

export default function ChatList({
  messages,
  loading,
  onDiagnoseAction,
}: {
  messages: ChatMsg[];
  loading: boolean;
  /** 掌握度回路回调（明白了/还不懂/继续），由页面层接 useChat；缺省不渲染回路按钮 */
  onDiagnoseAction?: (event: DiagnoseRequestEvent, label: string) => void;
}) {
  // 滚动跟随收口在页面层（app/chat/page.tsx）：用户操作优先的条件式吸底（doc/mobile-ux.md §3）
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
          <span className="text-4xl">💬</span>
          <h2 className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>
            开始对话
          </h2>
          <p className="max-w-md text-sm" style={{ color: 'var(--text-muted)' }}>
            输入问题并发送，模型回复会显示在这里。
          </p>
        </div>
      )}

      {messages.map((m, i) => (
        <div
          key={i}
          className={
            m.role === 'user'
              ? 'self-end rounded-2xl rounded-br-md px-4 py-3 text-sm'
              : 'self-start max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 text-sm shadow-sm'
          }
          style={
            m.role === 'user'
              ? {
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--accent)',
                  color: 'var(--accent-text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxWidth: '85%',
                }
              : {
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-deep)',
                  color: 'var(--text)',
                  wordBreak: 'break-word',
                }
          }
        >
          {m.role === 'assistant' && m.reasoning ? <ThinkingBlock reasoning={m.reasoning} /> : null}
          {m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 ? (
            <ToolTrace calls={m.toolCalls} />
          ) : null}

          {m.role === 'assistant' ? (
            // ask_user 待回答的问题由输入区问题面板（AskUserPanel）承载，不再渲染气泡卡片；
            // 正文只渲染模型前导文本，前导为空时不渲染空泡
            m.awaitingQuestions && !m.content ? null : (
              <>
                <div className="markdown-body text-sm">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeSanitizeMarkdown, rehypeKatex]}
                  >
                    {m.content || '…'}
                  </ReactMarkdown>
                </div>
                {m.content ? <CopyButton text={m.content} /> : null}
                {m.diagnosis ? <DiagnosisCard result={m.diagnosis} onAction={onDiagnoseAction} /> : null}
              </>
            )
          ) : (
            <>
              {m.files && m.files.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {m.files.map((file, idx) => (
                    <span
                      key={`file-${idx}`}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
                      style={{
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-deep)',
                        color: 'var(--text-secondary)',
                      }}
                      title={`${file.name}（${file.text.length} 字符）`}
                    >
                      <span className="max-w-[160px] truncate">{file.name}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {file.text.length >= 1000
                          ? `${(file.text.length / 1000).toFixed(1)}k`
                          : file.text.length}
                        字符
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
              {m.images && m.images.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {m.images.map((src, idx) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`img-${idx}`}
                      src={src}
                      alt={`上传图片 ${idx + 1}`}
                      className="h-24 w-24 rounded-lg object-cover"
                      style={{ border: '1px solid var(--border)' }}
                    />
                  ))}
                </div>
              ) : null}
              {m.ocrTexts && m.ocrTexts.length > 0 ? (
                <div className="mb-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
                    style={{
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-deep)',
                      color: 'var(--text-secondary)',
                    }}
                    title={`图片已在浏览器本地OCR转文字后发送，原图未离开浏览器：\n${m.ocrTexts.join('\n---\n')}`}
                  >
                    🖼️→📄 已本地OCR转文字（{m.ocrTexts.length} 张）
                  </span>
                </div>
              ) : null}
              {m.content ? <div>{m.content}</div> : null}
            </>
          )}
        </div>
      ))}

      {loading && (
        <div className="flex justify-start">
          <div
            className="flex items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3 text-sm"
            style={{
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-deep)',
              color: 'var(--text-secondary)',
            }}
          >
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: 'var(--accent)' }}
            />
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: 'var(--accent)' }}
            />
            <span className="ml-1">模型思考中…</span>
          </div>
        </div>
      )}
    </div>
  );
}
