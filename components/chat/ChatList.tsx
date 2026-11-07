'use client';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  /** 用户随消息上传的图片 dataUrl */
  images?: string[];
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

export default function ChatList({ messages, loading }: { messages: ChatMsg[]; loading: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

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

          {m.role === 'assistant' ? (
            <div className="markdown-body text-sm">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeRaw]}
              >
                {m.content || '…'}
              </ReactMarkdown>
            </div>
          ) : (
            <>
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
      <div ref={bottomRef} />
    </div>
  );
}
