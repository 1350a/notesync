"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import {
  loadConversations,
  createConversation,
  updateConversation,
  deleteConversation,
  appendMessage,
  makeTitle,
  genId,
  DEFAULT_MODEL,
} from "@/lib/storage";
import type {
  Attachment,
  Conversation,
  Message,
  ModelsResponse,
} from "@/lib/types";

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelsResponse["models"]>([]);
  const [ollamaAvailable, setOllamaAvailable] = useState(true);
  const [ollamaMessage, setOllamaMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  /** 初始化：读取本地会话 + 拉取模型列表 */
  useEffect(() => {
    const stored = loadConversations();
    setConversations(stored);
    if (stored.length > 0) {
      setActiveId(stored[0].id);
    }

    fetch("/api/models")
      .then((r) => r.json() as Promise<ModelsResponse>)
      .then((data) => {
        setModels(data.models);
        setOllamaAvailable(data.available);
        setOllamaMessage(data.message ?? "");
        // 若当前默认模型不在列表且已有会话，保留会话自带模型，否则切到第一个可用模型
        if (data.models.length > 0 && !data.models.some((m) => m.name === DEFAULT_MODEL)) {
          setDefaultModelForNew(data.models[0].name);
        }
      })
      .catch(() => {
        setOllamaAvailable(false);
        setOllamaMessage("无法连接 ollama 服务，请确认已启动。");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDefaultModelForNew = (model: string) => {
    // 仅影响新建会话时的默认模型（通过 state 记录）
    newModelRef.current = model;
  };

  const newModelRef = useRef(DEFAULT_MODEL);

  /** 滚动到底部 */
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [active?.messages.length, loading, scrollToBottom]);

  /** 新建会话 */
  const handleNew = () => {
    const conv = createConversation("新会话", newModelRef.current);
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
  };

  /** 切换会话 */
  const handleSelect = (id: string) => {
    setActiveId(id);
  };

  /** 删除会话 */
  const handleDelete = (id: string) => {
    deleteConversation(id);
    const next = loadConversations();
    setConversations(next);
    if (activeId === id) {
      setActiveId(next.length > 0 ? next[0].id : null);
    }
  };

  /** 发送消息：追加用户消息 -> 调用 /api/chat -> 追加 AI 回复 */
  const handleSend = async (content: string, attachments: Attachment[]) => {
    let conv = active;
    if (!conv) {
      conv = createConversation(makeTitle(content || "新会话"), newModelRef.current);
      setConversations((prev) => [conv!, ...prev]);
      setActiveId(conv.id);
    }

    // 首条消息：用内容做标题
    if (conv.messages.length === 0 && content) {
      conv = updateConversation(conv.id, { title: makeTitle(content) }) ?? conv;
      setConversations((prev) => prev.map((c) => (c.id === conv!.id ? conv! : c)));
    }

    const userMessage: Message = {
      id: genId(),
      role: "user",
      content,
      attachments,
      createdAt: Date.now(),
    };
    conv = appendMessage(conv.id, userMessage) ?? conv;
    setConversations((prev) => prev.map((c) => (c.id === conv!.id ? conv! : c)));
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conv.id,
          model: conv.model,
          messages: conv.messages,
        }),
      });
      const data = (await res.json()) as {
        content: string;
        model?: string;
        error?: string;
      };

      const assistantMessage: Message = {
        id: genId(),
        role: "assistant",
        content: data.error ? `⚠️ ${data.error}` : data.content,
        attachments: [],
        createdAt: Date.now(),
        model: data.model || conv.model,
      };
      const updated = appendMessage(conv!.id, assistantMessage);
      if (updated) {
        setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
    } catch {
      const failed: Message = {
        id: genId(),
        role: "assistant",
        content: "⚠️ 网络异常，请确认 ollama 已启动后重试。",
        attachments: [],
        createdAt: Date.now(),
      };
      const updated = appendMessage(conv!.id, failed);
      if (updated) {
        setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
    } finally {
      setLoading(false);
    }
  };

  /** 切换模型（更新当前会话） */
  const handleModelChange = (model: string) => {
    if (!active) return;
    const updated = updateConversation(active.id, { model });
    if (updated) {
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    }
    newModelRef.current = model;
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />

      {/* 中间消息区 */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-deep)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <div>
              <h1 className="text-sm font-semibold">错题认知诊断引擎</h1>
              <p className="text-xs text-[var(--text-muted)]">
                多轮对话 · 定位薄弱点 · 生成复习方案
              </p>
            </div>
          </div>
          {/* ollama 状态提示 */}
          {!ollamaAvailable && (
            <div className="flex max-w-md items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
              <span>⚠️</span>
              <span className="truncate">
                {ollamaMessage || "ollama 未连接"}
              </span>
            </div>
          )}
        </header>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {active && active.messages.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <span className="text-4xl">📚</span>
                <h2 className="text-lg font-medium text-[var(--text-secondary)]">
                  开始第一轮诊断
                </h2>
                <p className="max-w-md text-sm text-[var(--text-muted)]">
                  粘贴或输入你的错题文字，也可上传错题图片/PDF。
                  <br />
                  通过多轮追问定位知识薄弱点，生成个性化复习方案。
                </p>
              </div>
            )}
            {!active && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <span className="text-4xl">💬</span>
                <h2 className="text-lg font-medium text-[var(--text-secondary)]">
                  新建一个会话开始诊断
                </h2>
                <p className="text-sm text-[var(--text-muted)]">
                  每个会话是一个独立的对话分支，互不干扰。
                </p>
              </div>
            )}
            {active?.messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--ai-bubble)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:0.15s]" />
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:0.3s]" />
                  <span className="ml-1">诊断思考中…</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* 输入区 */}
        <ChatInput
          models={models}
          selectedModel={active?.model ?? newModelRef.current}
          onModelChange={handleModelChange}
          onSend={handleSend}
          disabled={loading}
        />
      </main>
    </div>
  );
}
