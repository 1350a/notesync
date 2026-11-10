import { useCallback, useRef, useState } from 'react';
import type { ChatMsg, ChatTextFile, RagContext } from '@/lib/chat/messages';
import { RAG_SNIPPET_MAX_CHARS } from '@/lib/chat/messages';
import { CLIENT_ID_HEADER, getClientId } from '@/lib/client-id';
import { searchKnowledge } from '@/lib/local/rag/store';
import { useSettingsStore } from '@/store/useSettingsStore';
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
  // 本地检索开关（路由绝对权在使用者，默认关闭）；水合前读默认值即不检索
  const ragEnabled = useSettingsStore((s) => s.settings.rag.enabled);

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
    async (
      text: string,
      images: string[],
      files: ChatTextFile[] = [],
      ocrTexts?: string[]
    ) => {
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

      // ocrTexts 与 images 一一对应：本地 OCR 转文字模式产物，随消息上行供服务端
      // 以文本块拼进正文（doc/browser-local-ocr.md §6.2）；images 保留在本地用于气泡展示
      const userMsg: ChatMsg = {
        role: 'user',
        content: text,
        images,
        files,
        ...(ocrTexts && ocrTexts.length > 0 ? { ocrTexts } : {}),
      };
      const history = [...messages, userMsg];
      setMessages(history);
      setLoading(true);

      // 本地检索（doc/browser-local-inference.md §6.1）：开关打开且引擎就绪时，
      // 发送前在浏览器内检索种子知识库，命中片段随请求上行。引擎未就绪/嵌入失败
      // 一律静默跳过（数据不出设备，检索是纯增益），消息照常裸发、绝不阻断。
      let ragContexts: RagContext[] | undefined;
      if (ragEnabled && text.trim()) {
        try {
          const hits = await searchKnowledge(text);
          if (hits.length > 0) {
            ragContexts = hits.map((h) => ({
              title: h.chunk.title,
              snippet: h.chunk.content.slice(0, RAG_SNIPPET_MAX_CHARS),
              score: Math.round(h.score * 10000) / 10000,
            }));
          }
        } catch {
          // 静默跳过：设备内事件（§1 设备边界规则）
        }
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: '', reasoning: '' }]);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [CLIENT_ID_HEADER]: getClientId() },
          body: JSON.stringify({
            model: selectedModel,
            // 图片与文本文件随所属消息上行，由服务端组装（图片转多模态、文本拼进正文）；
            // OCR 模式消息只上行 imageTexts，图片本体不再出浏览器（省带宽且符合隐私语义）
            messages: history.map((m) => ({
              role: m.role,
              content: m.content,
              images: m.ocrTexts?.length ? undefined : m.images,
              imageTexts: m.ocrTexts,
              files: m.files,
            })),
            // 本地检索命中片段（可能为 undefined：开关关闭/引擎未就绪/未命中）
            ragContexts,
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
    [messages, loading, selectedModel, ragEnabled]
  );

  return { messages, loading, sendMessage, stopGeneration, clearMessages };
}
