'use client';

import ChatInput from '@/components/chat/ChatInput';
import ChatList from '@/components/chat/ChatList';
import AppLayout from '@/components/layout/AppLayout';
import { useChat } from '@/hooks/useChat';
import { useEffect, useState } from 'react';

interface ModelsItem {
  name: string;
  model: string;
}

export default function ChatPage() {
  const [models, setModels] = useState<ModelsItem[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  // 这里的解构对齐 useChat 的返回值
  const { messages, loading, sendMessage, stopGeneration } = useChat(selectedModel);

  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data: { models?: ModelsItem[] }) => {
        setModels(data.models || []);
        if (data.models?.length) setSelectedModel(data.models[0].name);
      });
  }, []);

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <ChatList messages={messages} loading={loading} />
        </div>

        <div className="px-4 py-4 border-t border-border bg-background">
          {/* 对齐 ChatInput 的参数：onSend 接收文字和图片，onStop 接收中止 */}
          <ChatInput onSend={sendMessage} onStop={stopGeneration} loading={loading} />
        </div>
      </div>
    </AppLayout>
  );
}
