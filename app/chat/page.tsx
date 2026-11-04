'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

interface ModelsItem {
  name: string;
  model: string;
}

/** 解析 SSE 事件块（event:/data: 行，空行分隔） */
function parseSseEvent(chunk: string): { event: string; data: Record<string, unknown> } | null {
  const lines = chunk.split('\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** 更新消息列表中最后一条 assistant 消息（流式追加用） */
function appendAssistant(list: ChatMsg[], updater: (m: ChatMsg) => ChatMsg): ChatMsg[] {
  const next = [...list];
  const i = next.length - 1;
  if (i >= 0 && next[i].role === 'assistant') next[i] = updater(next[i]);
  return next;
}

/** 思考过程折叠区（默认收起，点击展开） */
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
          className="mt-2 whitespace-pre-wrap warp-break-words text-xs leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          {reasoning}
        </pre>
      )}
    </div>
  );
}

/**
 * 简易聊天首页（简易重构版 + Markdown/SSE 流式）
 * 输入框 + 消息列表 + 发送；调用 /api/chat（SSE 流式）逐段消费并追加显示；
 * 模型回复以 react-markdown（+remark-math）渲染；assistant 气泡带可折叠“思考过程”区（默认收起）。
 * 历史“错题认知诊断引擎”落地页代码已注释保留在文件底部。
 */
export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [models, setModels] = useState<ModelsItem[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((data: { models?: ModelsItem[]; message?: string }) => {
        setModels(data.models ?? []);
        if (data.models && data.models.length > 0) {
          setSelectedModel(data.models[0].name);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: data.message || '未配置任何模型 API Key，请填写 .env.local 后重试。',
            },
          ]);
        }
      })
      .catch(() => {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '无法获取模型列表，请检查服务是否已启动。' },
        ]);
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMsg: ChatMsg = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setLoading(true);
    // 先插入空的 assistant 消息，后续 SSE 增量逐段追加
    setMessages((prev) => [...prev, { role: 'assistant', content: '', reasoning: '' }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.body) throw new Error('响应缺少流（body）');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const evt of events) {
          const parsed = parseSseEvent(evt);
          if (!parsed) continue;
          if (parsed.event === 'content' && typeof parsed.data.delta === 'string') {
            const delta = parsed.data.delta;
            setMessages((prev) =>
              appendAssistant(prev, (m) => ({ ...m, content: m.content + delta }))
            );
          } else if (parsed.event === 'reasoning' && typeof parsed.data.delta === 'string') {
            const delta = parsed.data.delta;
            setMessages((prev) =>
              appendAssistant(prev, (m) => ({ ...m, reasoning: (m.reasoning ?? '') + delta }))
            );
          } else if (parsed.event === 'done') {
            finished = true;
            break;
          } else if (parsed.event === 'error') {
            const msg = typeof parsed.data.error === 'string' ? parsed.data.error : '模型请求失败';
            setMessages((prev) =>
              appendAssistant(prev, (m) => ({ ...m, content: m.content + `[错误] ${msg}` }))
            );
            finished = true;
            break;
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        appendAssistant(prev, (m) => ({
          ...m,
          content:
            m.content + `[错误] 网络异常：${err instanceof Error ? err.message : '请求失败'}`,
        }))
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="flex h-screen flex-col"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}
    >
      <header
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-deep)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <div>
            <h1 className="text-sm font-semibold">错题认知诊断引擎 · 简易版</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              直接与模型对话（DEEPSEEK / ZHIPU / CUSTOM）
            </p>
          </div>
        </div>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="rounded-xl px-3 py-1.5 text-xs outline-none"
          style={{
            border: '1px solid var(--border)',
            backgroundColor: 'var(--panel-soft)',
            color: 'var(--text)',
          }}
        >
          {models.length === 0 && <option value="">未配置模型</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
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
                  : 'self-start max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 text-sm'
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
                      backgroundColor: 'var(--ai-bubble)',
                      color: 'var(--text)',
                      wordBreak: 'break-word',
                    }
              }
            >
              {m.role === 'assistant' && m.reasoning ? (
                <ThinkingBlock reasoning={m.reasoning} />
              ) : null}
              {m.role === 'assistant' ? (
                <div className="[&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:whitespace-pre-wrap [&_code]:break-all">
                  <ReactMarkdown remarkPlugins={[remarkMath]}>{m.content || '…'}</ReactMarkdown>
                </div>
              ) : (
                <div>{m.content}</div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div
                className="flex items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3 text-sm"
                style={{
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--ai-bubble)',
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
      </div>

      <footer
        className="px-4 py-3"
        style={{ borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg-deep)' }}
      >
        <div className="mx-auto flex max-w-3xl gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入你的问题，回车发送…"
            className="flex-1 rounded-2xl px-4 py-3 text-sm outline-none placeholder:text-sm"
            style={{
              border: '1px solid var(--border)',
              backgroundColor: 'var(--panel-soft)',
              color: 'var(--text)',
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="rounded-2xl px-6 py-3 text-sm font-medium transition disabled:opacity-50"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--accent-text)',
            }}
          >
            发送
          </button>
        </div>
      </footer>
    </main>
  );
}

/* =====================================================================
 * 【历史遗留代码 - 已注释停用，保留原文便于恢复】
 * 原实现（简易重构前 app/page.tsx）：错题认知诊断引擎落地页，
 * 含“开始诊断”引导（跳转 /diagnose）与“直接对话”入口（跳转 /chat）、
 * 特性卡片、背景装饰光斑等静态展示内容。
 * 简易重构后首页改为简易聊天界面，原跳转入口（/diagnose 等）不再使用。
 * 如需恢复，请还原此文件为旧版。
 * ===================================================================== */
