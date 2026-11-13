'use client';

import AskUserPanel from '@/components/chat/AskUserPanel';
import ChatInput from '@/components/chat/ChatInput';
import ChatList from '@/components/chat/ChatList';
import { useChat } from '@/hooks/useChat';
import { useModels } from '@/hooks/useModels';
import { useChatStore } from '@/store/useChatStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { findFirstHitIndex, normalizeKeyword, normalizeText } from '@/lib/history/search';
import type { DiagnoseRequestEvent } from '@/lib/diagnose/types';
import { useEffect, useMemo, useRef, useState } from 'react';

/** 距底 ≤ 80px 视为"在底部"，跟随新内容（doc/mobile-ux.md §3） */
const FOLLOW_BOTTOM_THRESHOLD = 80;
/** 距底 ≤ 16px 视为回到底部，复位用户打断状态 */
const NEAR_BOTTOM_THRESHOLD = 16;
/** 滚动位置较上次向上移动超过此差值即判为用户操作（滚轮/滚动条/键盘/触摸全覆盖） */
const SCROLL_UP_EPSILON = 4;

/**
 * 在元素已渲染文本里高亮关键词：逐文本节点包 <mark>。
 * 纯 DOM 操作（createElement / createTextNode），不走 innerHTML，无注入面，
 * 也不改 markdown sanitize 白名单；markdown 结构（代码块/链接内部）天然不拆。
 * 偏移按 normalizeText 等长映射计算（全角→半角 1:1）；极少数小写化展宽字符下
 * 允许定位偏差，属可接受近似（doc/chat-history.md §7.4）。
 */
function highlightKeyword(root: HTMLElement, keyword: string): void {
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const hits: Array<{ node: Text; ranges: Array<[number, number]> }> = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // mark 是上次高亮的残留（解包由调用方负责），script/style/textarea 内容一律不碰
    if (node.parentElement?.closest('mark, script, style, textarea')) continue;
    const value = node.nodeValue ?? '';
    if (!value.trim()) continue;
    const normalized = normalizeText(value);
    const ranges: Array<[number, number]> = [];
    let pos = normalized.indexOf(keyword);
    while (pos >= 0) {
      ranges.push([pos, pos + keyword.length]);
      pos = normalized.indexOf(keyword, pos + keyword.length);
    }
    if (ranges.length > 0) hits.push({ node: node as Text, ranges });
  }
  for (const { node, ranges } of hits) {
    const value = node.nodeValue ?? '';
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, start)));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = value.slice(start, end);
      frag.appendChild(mark);
      cursor = end;
    }
    if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)));
    node.parentNode?.replaceChild(frag, node);
  }
}

/** 解包元素内此前的高亮标记：关键词变更或同消息重复跳转时防叠层 */
function unhighlightKeyword(root: HTMLElement): void {
  root.querySelectorAll('mark.search-hit').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  });
}

export default function ChatPage() {
  const { models, providers, loading: modelsLoading, message, error, reload } = useModels();
  const [pickedModel, setPickedModel] = useState('');
  // 默认模型记忆：设置里保存的偏好，模型变更时回写（doc/user-settings.md §5）
  const defaultModel = useSettingsStore((s) => s.settings.defaultModel);
  const updateSettings = useSettingsStore((s) => s.update);

  // 选中模型为派生值：用户手选的仍有效则沿用；否则用设置里的默认模型（也须在列表中）；
  // 再回落到后端推荐的第一个。列表为空即空（不保留过期模型名，避免带着失效模型发请求）
  const selectedModel = useMemo(() => {
    if (models.length === 0) return '';
    if (pickedModel && models.some((m) => m.name === pickedModel)) return pickedModel;
    if (defaultModel && models.some((m) => m.name === defaultModel)) return defaultModel;
    return models[0].name;
  }, [models, pickedModel, defaultModel]);

  /** 用户手动换模型即视为新的默认偏好；失效模型不回写（保持派生回落逻辑兜底） */
  const handleModelChange = (model: string) => {
    setPickedModel(model);
    updateSettings({ defaultModel: model });
  };

  const {
    messages,
    loading,
    sendMessage,
    stopGeneration,
    clearMessages,
    diagnoseContext,
    deleteMessage,
    regenerate,
    editAndResend,
  } = useChat(selectedModel);

  // --- 条件式吸底（doc/mobile-ux.md §3）：用户操作优先，仅"未打断 ∧ 贴近底部"才跟随 ---
  const scrollRef = useRef<HTMLDivElement>(null);
  // 高频状态放 ref 避免每次 chunk 触发渲染；仅按钮可见性走 state
  const followState = useRef({ interrupted: false, atBottom: true, lastTop: 0 });
  const [showBackToBottom, setShowBackToBottom] = useState(false);

  /** scroll 事件统一入口：维护距底/打断状态并同步按钮可见性 */
  const syncFollowUi = () => {
    const el = scrollRef.current;
    if (!el) return;
    const state = followState.current;
    // 方向增量法：程序吸底只向下，向上位移必是用户操作
    if (el.scrollTop < state.lastTop - SCROLL_UP_EPSILON) state.interrupted = true;
    state.lastTop = el.scrollTop;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    state.atBottom = distance <= FOLLOW_BOTTOM_THRESHOLD;
    if (distance <= NEAR_BOTTOM_THRESHOLD) state.interrupted = false;
    setShowBackToBottom(state.interrupted && distance > NEAR_BOTTOM_THRESHOLD);
  };

  // 跟随新内容：流式即时贴底（不用 smooth，连续动画观感发飘）；
  // 搜索跳转未消费期间让位——视口要停在命中消息处，不能被拽回底部（§7.4）
  const pendingJump = useChatStore((s) => s.pendingJump);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const clearPendingJump = useChatStore((s) => s.clearPendingJump);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const state = followState.current;
    if (pendingJump || state.interrupted || !state.atBottom) return;
    el.scrollTop = el.scrollHeight;
    state.lastTop = el.scrollTop;
  }, [messages, loading, pendingJump]);

  // 搜索命中跳转（doc/chat-history.md §7.4）：会话加载完成（sessionId 与 messages
  // 都已就位）后定位首条命中消息，居中滚动 + 闪烁 + 正文内 <mark>；仅标题命中不定位。
  // 载荷在 openSession 时原子写入、任意后续 openSession 覆盖清除，这里只做消费
  useEffect(() => {
    if (!pendingJump) return;
    if (pendingJump.sessionId !== currentSessionId) return;
    const keyword = normalizeKeyword(pendingJump.keyword);
    if (!keyword) {
      clearPendingJump();
      return;
    }
    const index = findFirstHitIndex(messages, keyword);
    if (index < 0) {
      clearPendingJump();
      return;
    }
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-msg-index="${index}"]`);
    if (!container || !target) {
      clearPendingJump();
      return;
    }
    // 跳转即视为用户打断：置位后吸底与"回到底部"按钮走既有打断链路
    const state = followState.current;
    state.interrupted = true;
    state.atBottom = false;
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    state.lastTop = container.scrollTop;
    unhighlightKeyword(target);
    highlightKeyword(target, keyword);
    // 重启动画：同消息重复跳转时先摘掉再戴回，强制重排确保 keyframes 重新播放
    target.classList.remove('search-hit-flash');
    void target.offsetWidth;
    target.classList.add('search-hit-flash');
    clearPendingJump();
  }, [pendingJump, currentSessionId, messages, clearPendingJump]);

  const handleBackToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    followState.current.interrupted = false;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowBackToBottom(false);
  };

  /**
   * 发送例外（doc/mobile-ux.md §3 表格「发送例外」）：发送即明确表示"要看新内容"，
   * 无论当前是否被判定为打断、是否贴近底部，都无条件吸底一次并复位打断态，
   * 否则用户上翻后按发送，新回答会从屏幕外开始流式，观感像没有响应。
   * 吸底用 auto（与流式一致）：此处是纠偏而非导航，动画反而让人等。
   */
  const handleSend: typeof sendMessage = (...args) => {
    const el = scrollRef.current;
    if (el) {
      const state = followState.current;
      state.interrupted = false;
      state.atBottom = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      state.lastTop = el.scrollTop;
      setShowBackToBottom(false);
    }
    return sendMessage(...args);
  };

  /** 掌握度回路（明白了/还不懂/继续）：作为带事件的诊断消息发送，按钮文案即用户气泡内容 */
  const handleDiagnoseAction = (event: DiagnoseRequestEvent, label: string) => {
    void handleSend(label, [], [], undefined, { diagnoseEvent: event });
  };
  // 图片处理偏好（设置页"优先本地OCR"）：交由 ChatInput 派生图片发送方式
  const preferLocalOcr = useSettingsStore((s) => s.settings.ocr.preferLocal);

  // 顶栏「新建对话」：信号递增即清空当前会话（首帧不触发）
  const newChatSignal = useChatStore((s) => s.newChatSignal);
  const seenSignal = useRef(newChatSignal);
  useEffect(() => {
    if (newChatSignal === seenSignal.current) return;
    seenSignal.current = newChatSignal;
    clearMessages();
  }, [newChatSignal, clearMessages]);

  const notice = error ?? message;

  // ask_user 待回答的问题挂在最后一条 assistant 消息上（useChat 写入）：
  // 存在且不在流式生成中时，输入区切换为问题面板，回答即发送一条普通消息
  const pendingAskQuestions = useMemo(() => {
    if (loading) return null;
    const last = messages[messages.length - 1];
    return last?.role === 'assistant' && last.awaitingQuestions?.length
      ? last.awaitingQuestions
      : null;
  }, [messages, loading]);

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        onScroll={syncFollowUi}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        <ChatList
          messages={messages}
          loading={loading}
          onDiagnoseAction={handleDiagnoseAction}
          onDeleteMessage={deleteMessage}
          onRegenerate={() => void regenerate()}
          onEditResend={(index, text) => void editAndResend(index, text)}
        />
      </div>

      {notice && (
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex-1">{notice}</span>
            <button
              onClick={() => void reload()}
              className="shrink-0 font-medium text-foreground underline underline-offset-2 hover:opacity-80"
            >
              重新检测
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-4 border-t border-border bg-background">
        {showBackToBottom && (
          <div className="flex justify-center pb-2">
            <button
              onClick={handleBackToBottom}
              className="rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs shadow-md backdrop-blur hover:bg-muted touch:px-4 touch:py-2.5"
            >
              ↓ 回到底部
            </button>
          </div>
        )}
        {pendingAskQuestions ? (
          <AskUserPanel
            questions={pendingAskQuestions}
            onSubmit={(text) => void handleSend(text, [], [])}
          />
        ) : (
          <ChatInput
            onSend={handleSend}
            onStop={stopGeneration}
            loading={loading}
            models={models}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            providers={providers}
            modelsLoading={modelsLoading}
            modelsMessage={notice}
            preferLocalOcr={preferLocalOcr}
            diagnosisActive={diagnoseContext !== null && diagnoseContext.state !== 'done'}
          />
        )}
      </div>
    </div>
  );
}
