'use client';

import ChatHeader from '@/components/chat/ChatHeader';
import ChatSidebar from '@/components/chat/ChatSidebar'; // 引入侧边栏
import SettingsModal from '@/components/SettingsModal';
import { useChatStore } from '@/store/useChatStore';
import { useEffect, useState } from 'react';

export default function ChatPage() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const { isSettingsOpen, setSettingsOpen } = useChatStore();

  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        setModels(data.models || []);
        if (data.models?.length > 0) setSelectedModel(data.models[0].name);
      });
  }, []);

  return (
    // 最外层用 flex-row，让左右排开
    <div className="flex h-screen w-full overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      {/* 侧边栏组件 */}
      <ChatSidebar />

      {/* 右侧聊天主区域 */}
      <main className="flex flex-col flex-1 h-full min-w-0" style={{ color: 'var(--text)' }}>
        <ChatHeader
          models={models}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
        />

        <div className="flex-1 overflow-y-auto px-4 py-6 flex items-center justify-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            聊天列表区域 (待迁移)
          </p>
        </div>

        <div className="px-4 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            输入框区域 (待迁移)
          </p>
        </div>
      </main>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
