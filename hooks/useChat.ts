import { useCallback, useRef, useState } from 'react';
import type { ChatMsg, ChatTextFile } from '@/lib/chat/messages';
import type { AskUserQuestion } from '@/lib/tools/types';

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

      // 上一条 assistant 还有待回答的 ask_user 时先回填其工具轨迹：
      // ask_user 是中断语义、没有 tool_result 事件，不回填则"等待回答"永远挂起
      setMessages((prev) => {
        const i = prev.length - 1;
        const last = prev[i];
        if (last?.role !== 'assistant' || !last.awaitingQuestions?.length) return prev;
        const next = [...prev];
        next[i] = {
          ...last,
          toolCalls: (last.toolCalls ?? []).map((t) =>
            t.name === 'ask_user' && !t.result
              ? { ...t, result: { ok: true, summary: '用户已回答', ms: 0 } }
              : t
          ),
        };
        return next;
      });

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
              // 问题列表只挂在本条 assistant 消息上，供输入区问题面板消费；
              // content 保留模型前导文本，问答上下文由下一轮用户回答消息自带。
              // 服务端保证 questions 非空，这里仍窄化防御脏数据
              const questions = Array.isArray(parsed.data.questions)
                ? (parsed.data.questions as AskUserQuestion[])
                : [];
              if (questions.length > 0) {
                appendAssistant((m) => ({ ...m, awaitingQuestions: questions }));
              }
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
