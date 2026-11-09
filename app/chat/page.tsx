'use client';

import AskUserPanel from '@/components/chat/AskUserPanel';
import ChatInput from '@/components/chat/ChatInput';
import ChatList from '@/components/chat/ChatList';
import AppLayout from '@/components/layout/AppLayout';
import { useChat } from '@/hooks/useChat';
import { useModels } from '@/hooks/useModels';
import { useChatStore } from '@/store/useChatStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useEffect, useMemo, useRef, useState } from 'react';

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

  const { messages, loading, sendMessage, stopGeneration, clearMessages } =
    useChat(selectedModel);

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
    <AppLayout>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <ChatList messages={messages} loading={loading} />
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
          {pendingAskQuestions ? (
            <AskUserPanel
              questions={pendingAskQuestions}
              onSubmit={(text) => void sendMessage(text, [], [])}
            />
          ) : (
            <ChatInput
              onSend={sendMessage}
              onStop={stopGeneration}
              loading={loading}
              models={models}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              providers={providers}
              modelsLoading={modelsLoading}
              modelsMessage={notice}
            />
          )}
        </div>
      </div>
    </AppLayout>
  );
}
