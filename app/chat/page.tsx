'use client';

import ChatInput from '@/components/chat/ChatInput';
import ChatList from '@/components/chat/ChatList';
import AppLayout from '@/components/layout/AppLayout';
import { useChat } from '@/hooks/useChat';
import { useModels } from '@/hooks/useModels';
import { useChatStore } from '@/store/useChatStore';
import { useEffect, useMemo, useRef, useState } from 'react';

export default function ChatPage() {
  const { models, providers, loading: modelsLoading, message, error, reload } = useModels();
  const [pickedModel, setPickedModel] = useState('');

  // 选中模型为派生值：用户选过的模型仍在列表中则沿用，否则回落到后端推荐的第一个，
  // 列表为空即空（不保留过期模型名，避免带着失效模型发请求）
  const selectedModel = useMemo(() => {
    if (models.length === 0) return '';
    if (pickedModel && models.some((m) => m.name === pickedModel)) return pickedModel;
    return models[0].name;
  }, [models, pickedModel]);

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
          <ChatInput
            onSend={sendMessage}
            onStop={stopGeneration}
            loading={loading}
            models={models}
            selectedModel={selectedModel}
            onModelChange={setPickedModel}
            providers={providers}
            modelsLoading={modelsLoading}
            modelsMessage={notice}
          />
        </div>
      </div>
    </AppLayout>
  );
}
