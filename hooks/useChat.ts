import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMsg, ChatTextFile, RagContext } from '@/lib/chat/messages';
import { RAG_SNIPPET_MAX_CHARS } from '@/lib/chat/messages';
import { CLIENT_ID_HEADER, getClientId, getUserId } from '@/lib/client-id';
import type { DiagnoseContext, DiagnoseRequestEvent, DiagnosisResult } from '@/lib/diagnose/types';
import { acquireLocalEngine } from '@/lib/local/engine-lease';
import { shouldRetrieve } from '@/lib/local/rag/gate';
import { searchKnowledge } from '@/lib/local/rag/store';
import {
  mergeExpiredRefs,
  refreshMeta,
  shiftExpiredRefsOnDelete,
  trimExpiredRefs,
} from '@/lib/history/contract';
import { deriveTitleFromMessages } from '@/lib/history/title';
import { ensurePersistentStorage, getHistoryStorage } from '@/lib/history/storage';
import { SAVE_DEBOUNCE_MS, createSessionMeta } from '@/lib/history/types';
import type { ExpiredImageRef, SessionMeta, SessionRecord } from '@/lib/history/types';
import { useChatStore } from '@/store/useChatStore';
import {
  BLOCK_COOLDOWN_MS,
  BLOCKED_USER_PLACEHOLDER,
  blockCooldownMessage,
  CONTENT_BLOCKED_MESSAGE,
  HARD_BLOCK_MESSAGE,
  PSYCH_SUPPORT_MESSAGE,
} from '@/lib/safety/messages';
import { checkInputSafety, loadWordlist } from '@/lib/safety/wordlist';
import { finalizeTrace, recordEvent, startTrace } from '@/lib/chat/trace';
import type { TraceBlocked } from '@/lib/chat/trace';
import type { TokenUsage } from '@/lib/provider/types';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { AskUserQuestion } from '@/lib/tools/types';

/** done.usage 的轻量校验：只收数字字段，缺失即整体丢弃（用量记账不能靠猜） */ 
function parseTraceUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const pick = (key: string): number | undefined => {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };
  const promptTokens = pick('promptTokens');
  const completionTokens = pick('completionTokens');
  const totalTokens = pick('totalTokens');
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * 用户主动中止生成的标记后缀（唯一文案出口）。
 *
 * 统一为「已中止」，并由 sendMessage 的 abort 分支**只追加一次**；
 * 旧文案「已停止生成」已废弃，避免同一条消息里出现两种表述。
 */
const ABORTED_SUFFIX = '\n\n*[已中止]*';

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

/**
 * 发送前回填上一条 assistant 的 ask_user 中断（doc/chat-history.md §8.3 顺带修正）。
 *
 * ask_user 是中断语义、没有 tool_result 事件，不回填则"等待回答"永远挂起。
 * 提成纯函数是为了在发送链路上**先算再同步写 ref**：请求体组装读的是 ref，
 * 若只靠 setMessages 的 updater，闭包里读到的仍是回填前的数组。
 */
function backfillAwaitingQuestions(prev: ChatMsg[]): ChatMsg[] {
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
}

export interface SendOptions {
  /** 开启诊断模式：无进行中会话时以 intake 重新开题（空 payload） */
  startDiagnosis?: boolean;
  /** 诊断回路事件（明白了/还不懂/继续/结束），随本次消息一并上行 */
  diagnoseEvent?: DiagnoseRequestEvent;
  /**
   * 【legacy，2026-11-14 起新发送不再写入】本条消息 OCR 产物的发送形态
   * （doc/browser-local-ocr.md §6.2）：仅用于重发旧持久化会话里的混合档消息
   * （regenerate/editAndResend 透传 ChatMsg.imageSendMode）。新发送缺省即
   * 「有 ocrTexts 全本地」；混合档 UI 已下线，字段仅为旧数据重发保真保留
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
  // 侧栏改名广播（doc/chat-history.md §8.1）
  const renameSignal = useChatStore((s) => s.renameSignal);
  const renamedSession = useChatStore((s) => s.renamedSession);
  const seenRenameSignalRef = useRef(0);
  // 连续拦截计数与冷却截止时间（同会话级，存内存；刷新页面即重置）。
  // 语义：被拒内容靠「打标 + 占位替换」阻断原样重发，但用户可能换个说法反复试探，
  // 因此连续 2 次拦截后进入 60s 冷却，冷却期内请求都不出端（doc/safety-design.md §4）
  const blockStreakRef = useRef(0);
  const cooldownUntilRef = useRef(0);

  /** 记一次拦截；触及阈值即进入冷却并清零计数（避免冷却结束后一票否决） */
  const noteBlock = useCallback(() => {
    blockStreakRef.current += 1;
    if (blockStreakRef.current >= 2) {
      cooldownUntilRef.current = Date.now() + BLOCK_COOLDOWN_MS;
      blockStreakRef.current = 0;
    }
  }, []);

  /** 一次干净的往返（无拦截）即清零，避免历史拦截长期累积成冷却 */
  const notePass = useCallback(() => {
    blockStreakRef.current = 0;
  }, []);
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

  // 消费改名广播：同步 sessionMetaRef 的标题与 titleEdited（不改 updatedAt，改名不是活动）。
  // 不回写 state 也不在 effect 体内 setState，故不受级联渲染约束
  useEffect(() => {
    if (renameSignal === seenRenameSignalRef.current) return;
    seenRenameSignalRef.current = renameSignal;
    const base = sessionMetaRef.current;
    if (!renamedSession || !base || base.id !== renamedSession.id) return;
    sessionMetaRef.current = { ...base, title: renamedSession.title, titleEdited: true };
  }, [renameSignal, renamedSession]);

  const sendMessage = useCallback(
    async (text: string, images: string[], files: ChatTextFile[] = [], ocrTexts?: string[], options?: SendOptions) => {
      if ((!text.trim() && images.length === 0 && files.length === 0) || loading) return;

      // 冷却期内直接挡在入口：被拒内容不出端，也不留待回答状态。
      // 冷却只按时间自解，不做「倒计时刷新」——避免为了 UI 秒数引入定时器与额外渲染
      if (Date.now() < cooldownUntilRef.current) {
        const leftSec = (cooldownUntilRef.current - Date.now()) / 1000;
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: text, blocked: true },
          { role: 'assistant', content: blockCooldownMessage(leftSec), localOnly: true },
        ]);
        return;
      }

      // 输入侧本地前置过滤（safety-protocol.md §4，客户端优先：命中数据不出端）。
      // 只判纯文本输入；附件/OCR 产物不在词表范围（§4 语义判定交上游 + 形态归一）。
      // 命中即在本机挂提示气泡，不建立请求、不留待回答状态。
      // 被拒的 user 消息打 blocked 标记：原文留在本机供用户回看「被拦了什么」，
      // 但下一轮上行时替换为占位文本（doc/safety-design.md §4）
      const safety = checkInputSafety(text, loadWordlist());
      if (safety.level) {
        const notice: ChatMsg = {
          role: 'assistant',
          content: safety.level === 'psych' ? PSYCH_SUPPORT_MESSAGE : HARD_BLOCK_MESSAGE,
          localOnly: true,
        };
        setMessages((prev) => [...prev, { role: 'user', content: text, blocked: true }, notice]);
        noteBlock();
        return;
      }

      abortControllerRef.current = new AbortController();

      // 上一条 assistant 还有待回答的 ask_user 时先回填其工具轨迹：
      // ask_user 是中断语义、没有 tool_result 事件，不回填则"等待回答"永远挂起
      const backfilled = backfillAwaitingQuestions(messagesRef.current);
      if (backfilled !== messagesRef.current) {
        messagesRef.current = backfilled;
        setMessages(backfilled);
      }

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
      // 上行历史读 ref 而非 messages 闭包：重新生成/编辑重发会先剪枝内存态再调发送，
      // 闭包里的数组仍是剪枝前的旧值（doc/chat-history.md §8.3）
      const history = [...messagesRef.current, userMsg];
      // 首条消息发出即确定会话身份（id 在这里生成）：点开"新建"但没发消息不会留下空会话
      if (!sessionMetaRef.current) {
        sessionMetaRef.current = createSessionMeta(createSessionId(), Date.now());
      }
      messagesRef.current = history;
      setMessages(history);
      setLoading(true);

      // 诊断负载组装：回路事件优先；无会话但用户开启诊断模式则以空 payload 开新题；
      // 会话已 done 视为结束，开启着开关就自动开下一题（省一次手动重开）。
      // 回答 ask_user 面板时必须带 clarify_done：ask_user 是中断语义，服务端无从从
      // 历史判断"这条消息是补问的回答"（toolCalls 不上行），缺了它状态机会卡死在 clarify。
      // 判定读 history 的倒数第二条——倒数第一条是刚拼进去的 userMsg
      const prevLast = history[history.length - 2];
      const answeredAskUser =
        diagnoseContext?.state !== 'done' &&
        prevLast?.role === 'assistant' &&
        (prevLast.awaitingQuestions?.length ?? 0) > 0;
      let diagnose: Record<string, unknown> | undefined;
      if (options?.diagnoseEvent) {
        diagnose = { ...(diagnoseContext ? { context: diagnoseContext } : {}), event: options.diagnoseEvent };
      } else if (answeredAskUser) {
        diagnose = {
          ...(diagnoseContext ? { context: diagnoseContext } : {}),
          event: { type: 'clarify_done', hasAnswer: Boolean(text.trim() || images.length || files.length), refused: false },
        };
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

      // trace 落盘（P3）：本次请求的 SSE 事件流带时间戳留本地，设置页可导出供调试看时间线。
      // 观测面：会话 ID / 思考档位 / 用户输入 / 诊断态在建 trace 时即固化，事后不可补
      let trace: ReturnType<typeof startTrace> | null = null;
      try {
        trace = startTrace('/api/chat', selectedModel, {
          conversationId: sessionMetaRef.current?.id,
          thinkingEffort,
          userInput: text,
          diagnoseState: diagnoseContext?.state,
        });
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [CLIENT_ID_HEADER]: getClientId() },
          body: JSON.stringify({
            model: selectedModel,
            // 图片与文本文件随所属消息上行，由服务端组装（图片转多模态、文本拼进正文）；
            // OCR 模式消息只上行 imageTexts，图片本体不再出浏览器（省带宽且符合隐私语义）
            messages: history
              .filter((m) => !m.localOnly && !(m.blocked && m.role === 'assistant'))
              .map((m) => {
                // 被拦的 user 消息：保留角色交替但正文换占位、附件不上行。
                // 直接过滤会让上游看到「assistant 有回答却无对应提问」的断裂历史
                if (m.blocked) {
                  return { role: m.role, content: BLOCKED_USER_PLACEHOLDER };
                }
                return {
                  role: m.role,
                  content: m.content,
                  // 【legacy 分支保留】旧混合档消息（imageSendMode==='mixed'）重发时原图仍随行，
                  // 不丢历史内容；新发送不再产出该形态。全本地：仅 imageTexts（图片仅本地展示）；
                  // 直传：仅原图（doc/browser-local-ocr.md §6.2）
                  images: m.imageSendMode === 'mixed' ? m.images : m.ocrTexts?.length ? undefined : m.images,
                  imageTexts: m.ocrTexts,
                  files: m.files,
                };
              }),
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
            // 给「最近一条还没打标的 user 消息」补 blocked：被拒内容不再原样上行，
            // 但气泡保留原文，用户能看清是哪条被拦（doc/safety-design.md §4）
            const markLastUserBlocked = () => {
              setMessages((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i -= 1) {
                  if (next[i].role !== 'user') continue;
                  if (!next[i].blocked) next[i] = { ...next[i], blocked: true };
                  break;
                }
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
              if (nextContext) {
                setDiagnoseContext(nextContext);
                trace.diagnoseState = nextContext.state;
              }
              // 精确用量：上游返回才有，缺省表示「上游未提供」而不是 0 token
              const usage = parseTraceUsage(parsed.data.usage);
              if (usage) trace.usage = usage;
              // 干净的往返：清掉连续拦截计数（冷却只认「连续」，不认历史总账）
              notePass();
              finished = true;
              break;
            } else if (parsed.event === 'error') {
              if (parsed.data.code === 'content_blocked') {
                // 拦截归因先入 trace（signal 区分 finish_reason 与拒绝性文本），再展示固定说明；
                // finalize 在 finally，先记录可保证归因不因 break 提前退出而丢失
                const blockedInfo: TraceBlocked = {
                  signal: parsed.data.signal === 'finish_reason' ? 'finish_reason' : 'content',
                  code: 'content_blocked',
                  ...(typeof parsed.data.finishReason === 'string'
                    ? { finishReason: parsed.data.finishReason }
                    : {}),
                };
                trace.blocked = blockedInfo;
                recordEvent(trace, 'blocked', blockedInfo);
                // 上游拦截（§2/§3.1）：丢弃已流出片段，展示固定说明并标记 blocked——
                // 本条 assistant 不回上行历史；对应的 user 提问原文同样打标后不再上行
                markLastUserBlocked();
                noteBlock();
                appendAssistant((m) => ({
                  ...m,
                  content: CONTENT_BLOCKED_MESSAGE,
                  blocked: true,
                }));
              } else if (parsed.data.code === 'input_blocked') {
                // 服务端输入兜底（doc/safety-design.md §3）：客户端漏判/被绕过时由服务端拦下。
                // 处置与本地硬拦截一致（同一话术、同样打标），区别只是证据留在服务端
                const blockedInfo: TraceBlocked = {
                  signal: 'input_guard',
                  code: 'input_blocked',
                  ...(typeof parsed.data.category === 'string' ? { category: parsed.data.category } : {}),
                };
                trace.blocked = blockedInfo;
                recordEvent(trace, 'blocked', blockedInfo);
                markLastUserBlocked();
                noteBlock();
                appendAssistant((m) => ({
                  ...m,
                  content: HARD_BLOCK_MESSAGE,
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
          // 注意：这里必须是纯函数式更新。原先 `next[i].content += ...` 原地改的是
          // prev 里同一个消息对象，StrictMode 下 updater 会被调用两次，导致
          // 「已停止生成」在气泡里重复渲染成两条；同时按后缀判重，双保险。
          setMessages((prev) => {
            const next = [...prev];
            const i = next.length - 1;
            if (i >= 0) {
              const current = next[i];
              const content = current.content.endsWith(ABORTED_SUFFIX)
                ? current.content
                : current.content + ABORTED_SUFFIX;
              if (content !== current.content) next[i] = { ...current, content };
            }
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
    [loading, selectedModel, ragEnabled, diagnoseContext, thinkingEffort, scheduleSave, noteBlock, notePass]
  );

  /**
   * 删除单条消息（doc/chat-history.md §8.3）。
   *
   * 三件事必须同批：消息数组移除 → expiredImages 下标左移 → 落库。
   * 漏掉第二步会把过期标记挪到下一条消息上（好图被显示成「图片已过期」）。
   * 删空即视为放弃这段对话：清内存态并删库，不留"点开就复活"的空壳会话。
   */
  const deleteMessage = useCallback(
    (index: number) => {
      if (loading) return;
      const current = messagesRef.current;
      if (index < 0 || index >= current.length) return;

      const next = current.filter((_, i) => i !== index);
      const nextExpired = shiftExpiredRefsOnDelete(expiredRefsRef.current, index);

      if (next.length === 0) {
        const sessionId = sessionMetaRef.current?.id ?? null;
        sessionMetaRef.current = null;
        expiredRefsRef.current = [];
        messagesRef.current = [];
        setMessages([]);
        setDiagnoseContext(null);
        setCurrentSessionId(null);
        if (sessionId) void useChatStore.getState().removeSession(sessionId);
        return;
      }

      expiredRefsRef.current = nextExpired;
      messagesRef.current = next;
      setMessages(next);
      scheduleSave();
    },
    [loading, scheduleSave, setCurrentSessionId]
  );

  /**
   * 重新生成：截断最后一条 user 消息之后的全部内容，用它自己再发一次。
   * 附件与 OCR 产物沿用原条，不重新读取；先剪枝 ref 再调 sendMessage，
   * 否则 sendMessage 组装的上行历史里还留着本该丢弃的旧回答。
   */
  const regenerate = useCallback(async () => {
    if (loading) return;
    const current = messagesRef.current;
    let userIndex = -1;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (current[i].role === 'user') {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) return;

    const source = current[userIndex];
    const trimmed = current.slice(0, userIndex);
    expiredRefsRef.current = trimExpiredRefs(expiredRefsRef.current, userIndex);
    messagesRef.current = trimmed;
    setMessages(trimmed);

    await sendMessage(
      source.content,
      source.images ?? [],
      source.files ?? [],
      source.ocrTexts,
      source.imageSendMode ? { imageSendMode: source.imageSendMode } : undefined
    );
  }, [loading, sendMessage]);

  /** 编辑重发：截断到目标 user 消息之前，用新正文重发；附件沿用原条（§8.3） */
  const editAndResend = useCallback(
    async (index: number, text: string) => {
      if (loading) return;
      const current = messagesRef.current;
      const target = current[index];
      if (!target || target.role !== 'user') return;
      if (!text.trim() && !(target.images?.length ?? 0) && !(target.files?.length ?? 0)) return;

      const trimmed = current.slice(0, index);
      expiredRefsRef.current = trimExpiredRefs(expiredRefsRef.current, index);
      messagesRef.current = trimmed;
      setMessages(trimmed);

      await sendMessage(
        text,
        target.images ?? [],
        target.files ?? [],
        target.ocrTexts,
        target.imageSendMode ? { imageSendMode: target.imageSendMode } : undefined
      );
    },
    [loading, sendMessage]
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
    /** 删除单条消息（§8.3）；删除后为空则整段会话作废 */
    deleteMessage,
    /** 重新生成最后一条回答（§8.3） */
    regenerate,
    /** 编辑某条 user 消息并重发（§8.3） */
    editAndResend,
    diagnoseContext,
  };
}
