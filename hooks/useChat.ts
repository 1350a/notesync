import { useCallback, useRef, useState } from 'react';
import type { ChatMsg, ChatTextFile, RagContext } from '@/lib/chat/messages';
import { RAG_SNIPPET_MAX_CHARS } from '@/lib/chat/messages';
import { CLIENT_ID_HEADER, getClientId, getUserId } from '@/lib/client-id';
import type { DiagnoseContext, DiagnoseRequestEvent, DiagnosisResult } from '@/lib/diagnose/types';
import { searchKnowledge } from '@/lib/local/rag/store';
import {
  CONTENT_BLOCKED_MESSAGE,
  HARD_BLOCK_MESSAGE,
  PSYCH_SUPPORT_MESSAGE,
} from '@/lib/safety/messages';
import { checkInputSafety, loadWordlist } from '@/lib/safety/wordlist';
import { finalizeTrace, recordEvent, startTrace } from '@/lib/chat/trace';
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

/** done.diagnose.context 的轻量校验：字段全对才收，脏数据一律丢弃（诊断态不可信客户端伪造，这里只防展示崩坏） */
function parseDiagnoseContext(raw: unknown): DiagnoseContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.subject !== 'math') return null;
  if (
    typeof record.state !== 'string' ||
    typeof record.clarifyUsed !== 'number' ||
    (record.hintLevel !== 1 && record.hintLevel !== 2 && record.hintLevel !== 3)
  ) {
    return null;
  }
  return {
    subject: 'math',
    state: record.state as DiagnoseContext['state'],
    clarifyUsed: record.clarifyUsed,
    hintLevel: record.hintLevel,
  };
}

/** diagnosis 事件的轻量校验：结构完整才挂上气泡，防脏数据渲染崩坏 */
function parseDiagnosisResult(raw: unknown): DiagnosisResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if ((record.level !== 'L1' && record.level !== 'L2') || !Array.isArray(record.knowledgePoints)) return null;
  return record as unknown as DiagnosisResult;
}

export interface SendOptions {
  /** 开启诊断模式：无进行中会话时以 intake 重新开题（空 payload） */
  startDiagnosis?: boolean;
  /** 诊断回路事件（明白了/还不懂/继续/结束），随本次消息一并上行 */
  diagnoseEvent?: DiagnoseRequestEvent;
  /**
   * 本条消息 OCR 产物的发送形态（doc/browser-local-ocr.md §6.2）：
   * local-only 全本地（图片仅本地展示）；mixed 混合档（OCR 文本+原图都上行）。
   * 缺省沿用旧口径（有 ocrTexts 即全本地）
   */
  imageSendMode?: 'local-only' | 'mixed';
}

export function useChat(selectedModel: string) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  /** 诊断会话上下文（服务端经 done.diagnose.context 回传，客户端仅持久不推导；null 即普通聊天） */
  const [diagnoseContext, setDiagnoseContext] = useState<DiagnoseContext | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 本地检索开关（路由绝对权在使用者，默认关闭）；水合前读默认值即不检索
  const ragEnabled = useSettingsStore((s) => s.settings.rag.enabled);
  // 思考强度档位（doc/user-settings.md §2.1）：随每次请求上行
  const thinkingEffort = useSettingsStore((s) => s.settings.generation.thinkingEffort);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  }, []);

  /** 新建对话：中断进行中的生成并清空消息（诊断会话一并作废） */
  const clearMessages = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setMessages([]);
    setDiagnoseContext(null);
  }, []);

  const sendMessage = useCallback(
    async (text: string, images: string[], files: ChatTextFile[] = [], ocrTexts?: string[], options?: SendOptions) => {
      if ((!text.trim() && images.length === 0 && files.length === 0) || loading) return;

      // 输入侧本地前置过滤（wip-safety-protocol.md §4，客户端优先：命中数据不出端）。
      // 只判纯文本输入；附件/OCR 产物不在词表范围（§4 语义判定交上游 + 形态归一）。
      // 命中即在本机挂提示气泡，不建立请求、不留待回答状态。
      const safety = checkInputSafety(text, loadWordlist());
      if (safety.level) {
        const notice: ChatMsg = {
          role: 'assistant',
          content: safety.level === 'psych' ? PSYCH_SUPPORT_MESSAGE : HARD_BLOCK_MESSAGE,
          localOnly: true,
        };
        setMessages((prev) => [...prev, { role: 'user', content: text }, notice]);
        return;
      }

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
        ...(ocrTexts && ocrTexts.length > 0 && options?.imageSendMode
          ? { imageSendMode: options.imageSendMode }
          : {}),
      };
      const history = [...messages, userMsg];
      setMessages(history);
      setLoading(true);

      // 诊断负载组装：回路事件优先；无会话但用户开启诊断模式则以空 payload 开新题；
      // 会话已 done 视为结束，开启着开关就自动开下一题（省一次手动重开）
      let diagnose: Record<string, unknown> | undefined;
      if (options?.diagnoseEvent) {
        diagnose = { ...(diagnoseContext ? { context: diagnoseContext } : {}), event: options.diagnoseEvent };
      } else if (options?.startDiagnosis) {
        diagnose = diagnoseContext && diagnoseContext.state !== 'done' ? { context: diagnoseContext } : {};
      } else if (diagnoseContext && diagnoseContext.state !== 'done') {
        diagnose = { context: diagnoseContext };
      }

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

      // trace 落盘（P3）：本次请求的 SSE 事件流带时间戳留本地，设置页可导出供调试看时间线
      let trace: ReturnType<typeof startTrace> | null = null;
      try {
        trace = startTrace('/api/chat', selectedModel);
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [CLIENT_ID_HEADER]: getClientId() },
          body: JSON.stringify({
            model: selectedModel,
            // 图片与文本文件随所属消息上行，由服务端组装（图片转多模态、文本拼进正文）；
            // OCR 模式消息只上行 imageTexts，图片本体不再出浏览器（省带宽且符合隐私语义）
            messages: history
              .filter((m) => !m.localOnly && !m.blocked)
              .map((m) => ({
                role: m.role,
                content: m.content,
                // 混合档：OCR 文本与原图同上行；全本地：仅 imageTexts（图片仅本地展示）；
                // 直传：仅原图（doc/browser-local-ocr.md §6.2）
                images: m.imageSendMode === 'mixed' ? m.images : m.ocrTexts?.length ? undefined : m.images,
                imageTexts: m.ocrTexts,
                files: m.files,
              })),
            // 本地检索命中片段（可能为 undefined：开关关闭/引擎未就绪/未命中）
            ragContexts,
            // 诊断负载（可能为 undefined：无会话且未开诊断模式即普通聊天）
            diagnose,
            // 上游终端用户标识（纯随机 UUID，doc/user-settings.md §4.1）
            user: getUserId() || undefined,
            // 思考强度档位（可能为 undefined：跟随 provider 默认）
            thinkingEffort,
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
            recordEvent(trace, parsed.event, parsed.data);
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
            } else if (parsed.event === 'diagnosis') {
              // 诊断模式结构化结果：挂上本条 assistant 消息交 DiagnosisCard 渲染
              const result = parseDiagnosisResult(parsed.data.result);
              if (result) {
                appendAssistant((m) => ({ ...m, diagnosis: result }));
              }
            } else if (parsed.event === 'done') {
              // 服务端推进后的最新诊断上下文；无该字段（普通聊天）保持原状
              const nextContext = parseDiagnoseContext(parsed.data.diagnose?.context);
              if (nextContext) setDiagnoseContext(nextContext);
              finished = true;
              break;
            } else if (parsed.event === 'error') {
              if (parsed.data.code === 'content_blocked') {
                // 上游拦截（§2/§3.1）：丢弃已流出片段，展示固定说明并标记 blocked——
                // 本条消息不进入下一轮上行历史（客户端侧回滚）
                appendAssistant((m) => ({
                  ...m,
                  content: CONTENT_BLOCKED_MESSAGE,
                  blocked: true,
                }));
              } else {
                appendAssistant((m) => ({
                  ...m,
                  content: m.content + `[错误] ${parsed.data.error}`,
                }));
              }
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
        if (trace) finalizeTrace(trace);
        setLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, loading, selectedModel, ragEnabled, diagnoseContext, thinkingEffort]
  );

  return { messages, loading, sendMessage, stopGeneration, clearMessages, diagnoseContext };
}
