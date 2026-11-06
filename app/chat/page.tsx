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

  // 你的核心 Hook 保持不变
  const { messages, loading, sendMessage, stopGeneration } = useChat(selectedModel);

  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data: { models?: ModelsItem[] }) => {
        setModels(data.models || []);
        if (data.models?.length) setSelectedModel(data.models[0].name);
      });
  }, []);

  // 删除了原本包裹在外层的 div、Sidebar、Header、SettingsModal
  // 直接把聊天核心塞进 AppLayout
  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        {/* 虽然顶栏在 AppLayout 里，但模型选择下拉框还需要放在某个地方。 */}
        {/* 我们可以暂时放在聊天区域的顶部，或者后续把模型选择做进 AppHeader 里 */}

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <ChatList messages={messages} loading={loading} />
        </div>

        <div className="px-4 py-4 border-t border-border bg-background">
          <ChatInput onSend={sendMessage} onStop={stopGeneration} loading={loading} />
        </div>
      </div>
    </AppLayout>
  );
}
