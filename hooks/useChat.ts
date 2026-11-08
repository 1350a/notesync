import { useCallback, useRef, useState } from 'react';
import type { ChatMsg, ChatTextFile } from '@/lib/chat/messages';

function parseSseEvent(chunk: string) {
  const lines = chunk.split('\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

export function useChat(selectedModel: string) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  }, []);

  /** 新建对话：中断进行中的生成并清空消息 */
  const clearMessages = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setMessages([]);
  }, []);

  const sendMessage = useCallback(
    async (text: string, images: string[], files: ChatTextFile[] = []) => {
      if ((!text.trim() && images.length === 0 && files.length === 0) || loading) return;

      abortControllerRef.current = new AbortController();

      const userMsg: ChatMsg = { role: 'user', content: text, images, files };
      const history = [...messages, userMsg];
      setMessages(history);
      setLoading(true);

      setMessages((prev) => [...prev, { role: 'assistant', content: '', reasoning: '' }]);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            // 图片与文本文件随所属消息上行，由服务端组装（图片转多模态、文本拼进正文）
            messages: history.map((m) => ({
              role: m.role,
              content: m.content,
              images: m.images,
              files: m.files,
            })),
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!res.body) throw new Error('响应缺少流');
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
            const appendAssistant = (updater: (m: ChatMsg) => ChatMsg) => {
              setMessages((prev) => {
                const next = [...prev];
                const i = next.length - 1;
                if (i >= 0) next[i] = updater(next[i]);
                return next;
              });
            };
            if (parsed.event === 'content') {
              appendAssistant((m) => ({ ...m, content: m.content + parsed.data.delta }));
            } else if (parsed.event === 'reasoning') {
              appendAssistant((m) => ({
                ...m,
                reasoning: (m.reasoning ?? '') + parsed.data.delta,
              }));
            } else if (parsed.event === 'tool_call') {
              appendAssistant((m) => ({
                ...m,
                toolCalls: [
                  ...(m.toolCalls ?? []),
                  { id: parsed.data.id, name: parsed.data.name, arguments: parsed.data.arguments },
                ],
              }));
            } else if (parsed.event === 'tool_result') {
              appendAssistant((m) => ({
                ...m,
                toolCalls: (m.toolCalls ?? []).map((t) =>
                  t.id === parsed.data.id
                    ? {
                        ...t,
                        result: { ok: parsed.data.ok, summary: parsed.data.summary, ms: parsed.data.ms },
                      }
                    : t
                ),
              }));
            } else if (parsed.event === 'awaiting_user') {
              // 问题写入 content：下一轮历史回放时模型才能看到问答上下文；
              // awaitingQuestion 供 UI 渲染提问卡片（替代正文，避免重复展示）
              appendAssistant((m) => ({
                ...m,
                content: parsed.data.question,
                awaitingQuestion: parsed.data.question,
              }));
            } else if (parsed.event === 'done') {
              finished = true;
              break;
            } else if (parsed.event === 'error') {
              appendAssistant((m) => ({
                ...m,
                content: m.content + `[错误] ${parsed.data.error}`,
              }));
              finished = true;
              break;
            }
          }
        }
      } catch (err: unknown) {
        const isAbortError = err instanceof Error && err.name === 'AbortError';
        if (isAbortError) {
          setMessages((prev) => {
            const next = [...prev];
            const i = next.length - 1;
            if (i >= 0) next[i].content += `\n\n*[已停止生成]*`;
            return next;
          });
        } else {
          setMessages((prev) => {
            const next = [...prev];
            const i = next.length - 1;
            if (i >= 0) next[i].content += `[网络异常]`;
            return next;
          });
        }
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, loading, selectedModel]
  );

  return { messages, loading, sendMessage, stopGeneration, clearMessages };
}
