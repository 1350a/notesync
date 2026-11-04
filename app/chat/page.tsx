'use client';

import ChatHeader from '@/components/chat/ChatHeader';
import SettingsModal from '@/components/SettingsModal';
import { useChatStore } from '@/store/useChatStore';
import { useEffect, useState } from 'react';

interface ModelsItem {
  name: string;
  model: string;
}

export default function ChatPage() {
  const [models, setModels] = useState<ModelsItem[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const { isSettingsOpen, setSettingsOpen } = useChatStore();

  // 获取可用模型列表
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((data: { models?: ModelsItem[] }) => {
        setModels(data.models ?? []);
        if (data.models && data.models.length > 0) {
          setSelectedModel(data.models[0].name);
        }
      });
  }, []);

  return (
    <main
      className="flex h-screen flex-col"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* 顶部导航组件 */}
      <ChatHeader models={models} selectedModel={selectedModel} onSelectModel={setSelectedModel} />

      {/* 中间：暂时留空，下一步把聊天列表放进来 */}
      <div className="flex-1 overflow-y-auto px-4 py-6 flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          聊天列表区域 (待迁移)
        </p>
      </div>

      {/* 底部：暂时留空，下一步把输入框放进来 */}
      <div className="px-4 py-4" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          输入框区域 (待迁移)
        </p>
      </div>

      {/* 全局弹窗 */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
