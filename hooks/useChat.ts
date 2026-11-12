import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMsg, ChatTextFile, RagContext } from '@/lib/chat/messages';
import { RAG_SNIPPET_MAX_CHARS } from '@/lib/chat/messages';
import { CLIENT_ID_HEADER, getClientId, getUserId } from '@/lib/client-id';
import type { DiagnoseContext, DiagnoseRequestEvent, DiagnosisResult } from '@/lib/diagnose/types';
import { acquireLocalEngine } from '@/lib/local/engine-lease';
import { shouldRetrieve } from '@/lib/local/rag/gate';
import { searchKnowledge } from '@/lib/local/rag/store';
import { mergeExpiredRefs, refreshMeta } from '@/lib/history/contract';
import { deriveTitleFromMessages } from '@/lib/history/title';
import { ensurePersistentStorage, getHistoryStorage } from '@/lib/history/storage';
import { SAVE_DEBOUNCE_MS, createSessionMeta } from '@/lib/history/types';
import type { ExpiredImageRef, SessionMeta, SessionRecord } from '@/lib/history/types';
import { useChatStore } from '@/store/useChatStore';
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

/** 会话 id：优先 crypto.randomUUID（仅安全上下文可用），降级时间戳 + 随机串 */
function createSessionId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 把存储层的过期坐标折算成消息上的展示态字段（doc/chat-history.md §4.1） */
function attachExpiredImages(messages: ChatMsg[], refs: ExpiredImageRef[]): ChatMsg[] {
  if (refs.length === 0) return messages;
  const next = [...messages];
  for (const ref of refs) {
    const target = next[ref.msg];
    if (!target) continue;
    const list = target.expiredImages ?? [];
    if (list.includes(ref.img)) continue;
    next[ref.msg] = { ...target, expiredImages: [...list, ref.img].sort((a, b) => a - b) };
  }
  return next;
}

/**
 * 淘汰结果回写内存态：清空对应图片槽位并留痕。
 * 不清会把已被删掉的附件继续挂在气泡上，用户点开还能看到"已过期"的图。
 */
function applyEviction(messages: ChatMsg[], expired: ExpiredImageRef[]): ChatMsg[] {
  if (expired.length === 0) return messages;
  const next = [...messages];
  for (const item of expired) {
    const target = next[item.msg];
    const current = target?.images?.[item.img];
    if (!target?.images || typeof current !== 'string' || current === '') continue;
    const images = [...target.images];
    images[item.img] = '';
    const list = target.expiredImages ?? [];
    const marked = list.includes(item.img) ? list : [...list, item.img].sort((a, b) => a - b);
    next[item.msg] = { ...target, images, expiredImages: marked };
  }
  return next;
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
  // ——会话历史接线（doc/chat-history.md §7）：messages 仍是本 hook 唯一的内存态，
  // 这里只补「什么时候落盘、怎么恢复」两条链路，不动发送与流式解析——
  /** 当前会话头；null = 尚未落库的新对话（id 在首条消息发出时生成） */
  const sessionMetaRef = useRef<SessionMeta | null>(null);
  /** 已过期附件坐标：落库时原样带回，避免同一条被重复淘汰 */
  const expiredRefsRef = useRef<ExpiredImageRef[]>([]);
  /** 落盘读最新内存态：state 给渲染、ref 给异步回调，防闭包读到旧数组 */
  const messagesRef = useRef<ChatMsg[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenOpenSignalRef = useRef(0);
  const openSessionSignal = useChatStore((s) => s.openSessionSignal);
  const pendingSessionId = useChatStore((s) => s.pendingSessionId);
  const setCurrentSessionId = useChatStore((s) => s.setCurrentSessionId);
  const clearPendingSession = useChatStore((s) => s.clearPendingSession);
  // 本地检索开关（路由绝对权在使用者，默认关闭）；水合前读默认值即不检索
  const ragEnabled = useSettingsStore((s) => s.settings.rag.enabled);
  // 思考强度档位（doc/user-settings.md §2.1）：随每次请求上行
  const thinkingEffort = useSettingsStore((s) => s.settings.generation.thinkingEffort);

  // 本地引擎租约（总账 §3）：开 RAG 时检索链路会顺手初始化引擎（searchKnowledge →
  // embedTexts → initLocalEngine），页面卸载要还；与能力页/设置分区共用同一份计数，
  // 最后一个使用方退出才 terminate。关闭 RAG 时只是计数，不触发下载或编译。
  useEffect(() => acquireLocalEngine(), []);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  }, []);

  /** 唯一写库出口：done / error / 停止 / 切换会话 / 新建会话前都会经过这里 */
  const flushSession = useCallback(async () => {
    const current = messagesRef.current;
    const base = sessionMetaRef.current;
    // 还没发过消息（无 id）或会话已空：不产生空壳条目
    if (!base || current.length === 0) return;

    const storage = getHistoryStorage();
    if (!storage.supported) return;

    // 标题只在用户没手改过时按首条用户消息派生（§2.3）；字节数/时间为实际内容
    const meta = refreshMeta(
      base.titleEdited ? base : { ...base, title: deriveTitleFromMessages(current) },
      current,
      Date.now()
    );
    const record: SessionRecord = {
      id: meta.id,
      messages: current,
      expiredImages: expiredRefsRef.current,
    };

    const result = await storage.saveSession(meta, record);
    sessionMetaRef.current = meta;
    if (result.status === 'unsupported') return;

    // 首次真正写成功后再申请持久化：只在用得上的环境里问一次（§3.3）
    ensurePersistentStorage();

    if (result.expired.length > 0) {
      expiredRefsRef.current = mergeExpiredRefs(expiredRefsRef.current, result.expired);
      setMessages((prev) => {
        const next = applyEviction(prev, result.expired);
        messagesRef.current = next;
        return next;
      });
    }

    setCurrentSessionId(meta.id);
    // 列表顺序按 updatedAt 倒序，写完必须刷新，否则新会话不会立刻出现在侧栏
    void useChatStore.getState().refreshSessions();
  }, [setCurrentSessionId]);

  /** 流式结束后的合并落库：一次请求只写一次（§3.1） */
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSession();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSession]);

  /** 丢弃当前会话且不落盘：会话已被删除时用，否则下一次落盘会把它重建出来 */
  const discardSession = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    sessionMetaRef.current = null;
    expiredRefsRef.current = [];
    messagesRef.current = [];
    setLoading(false);
    setMessages([]);
    setDiagnoseContext(null);
    setCurrentSessionId(null);
  }, [setCurrentSessionId]);

  /** 载入历史会话：先落盘当前会话，再回填目标会话（§7.2） */
  const loadSession = useCallback(
    async (id: string) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await flushSession();

      const record = await getHistoryStorage().loadSession(id);
      // 记录损坏（已被 sanitize 单条删除）或已不存在：保持当前会话不变，不摆空壳
      if (!record) return false;

      const meta =
        useChatStore.getState().sessions.find((item) => item.id === id) ??
        createSessionMeta(id, Date.now());
      const restored = attachExpiredImages(record.messages as ChatMsg[], record.expiredImages);
      sessionMetaRef.current = { ...meta };
      expiredRefsRef.current = record.expiredImages;
      messagesRef.current = restored;
      setMessages(restored);
      // 诊断会话上下文不随历史恢复（协议未落库该字段），一律按普通聊天接着聊
      setDiagnoseContext(null);
      setLoading(false);
      setCurrentSessionId(id);
      return true;
    },
    [flushSession, setCurrentSessionId]
  );

  /** 新建对话：中断生成、把旧会话落盘，再清空（诊断会话一并作废） */
  const clearMessages = useCallback(() => {
    void (async () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await flushSession();
      discardSession();
    })();
  }, [flushSession, discardSession]);

  // messages → ref 单向同步：setMessages 之后的下一次异步落盘都能读到最新内容
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 首屏恢复历史列表与能力判定（读 meta 表，不碰消息体）
  useEffect(() => {
    void useChatStore.getState().refreshSessions();
  }, []);

  // 消费侧栏发来的打开请求：pendingSessionId 为空表示"丢弃当前会话"。
  // 放进微任务：effect 体内同步 setState 会触发级联渲染（react-hooks 规则），
  // 且 loadSession 本身是异步链路，早一个 tick 晚一个 tick 无行为差异
  useEffect(() => {
    if (openSessionSignal === seenOpenSignalRef.current) return;
    seenOpenSignalRef.current = openSessionSignal;
    const target = pendingSessionId;
    queueMicrotask(() => {
      if (target) void loadSession(target);
      else discardSession();
      clearPendingSession();
    });
  }, [openSessionSignal, pendingSessionId, loadSession, discardSession, clearPendingSession]);

  const sendMessage = useCallback(
    async (text: string, images: string[], files: ChatTextFile[] = [], ocrTexts?: string[], options?: SendOptions) => {
      if ((!text.trim() && images.length === 0 && files.length === 0) || loading) return;

      // 输入侧本地前置过滤（safety-protocol.md §4，客户端优先：命中数据不出端）。
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
      // 首条消息发出即确定会话身份（id 在这里生成）：点开"新建"但没发消息不会留下空会话
      if (!sessionMetaRef.current) {
        sessionMetaRef.current = createSessionMeta(createSessionId(), Date.now());
      }
      messagesRef.current = history;
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
      // 触发条件见 §5.4：只有查询达到 RAG_MIN_QUERY_CHARS 才检索，短问候不白付一次嵌入。
      let ragContexts: RagContext[] | undefined;
      if (ragEnabled && shouldRetrieve(text)) {
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
        // done / error / 用户停止都走这里：合并一次落库（§3.1）
        scheduleSave();
      }
    },
    [messages, loading, selectedModel, ragEnabled, diagnoseContext, thinkingEffort, scheduleSave]
  );

  return {
    messages,
    loading,
    sendMessage,
    stopGeneration,
    clearMessages,
    /** 载入历史会话（供页面消费侧栏的打开请求时调用） */
    loadSession,
    /** 丢弃当前会话且不落盘（当前会话被删除时调用） */
    discardSession,
    diagnoseContext,
  };
}
