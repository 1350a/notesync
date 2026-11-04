'use client';

import ChatHeader from '@/components/chat/ChatHeader';
import ChatInput from '@/components/chat/ChatInput'; // 引入输入框
import ChatList, { ChatMsg } from '@/components/chat/ChatList'; // 引入列表
import ChatSidebar from '@/components/chat/ChatSidebar';
import SettingsModal from '@/components/SettingsModal';
import { getEffectiveSettings } from '@/lib/config';
import { useChatStore } from '@/store/useChatStore';
import { useEffect, useState } from 'react';

interface ModelsItem {
  name: string;
  model: string;
}

// SSE 解析逻辑保持原样
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

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [models, setModels] = useState<ModelsItem[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(false);

  const { isSettingsOpen, setSettingsOpen } = useChatStore();

  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data: { models?: ModelsItem[] }) => {
        setModels(data.models || []);
        if (data.models?.length) setSelectedModel(data.models[0].name);
      });
  }, []);
  // 测试Markdown渲染的代码
  // useEffect(() => {
  //   (window as any).setTestMessages = setMessages;
  // }, []);

  const handleSend = async (text: string) => {
    const userMsg: ChatMsg = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setLoading(true);
    setMessages((prev) => [...prev, { role: 'assistant', content: '', reasoning: '' }]);

    const currentConfig = getEffectiveSettings();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          config: {
            provider: currentConfig.provider,
            apiKey: currentConfig.apiKey,
            baseUrl: currentConfig.baseUrl,
          },
        }),
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
            appendAssistant((m) => ({ ...m, reasoning: (m.reasoning ?? '') + parsed.data.delta }));
          } else if (parsed.event === 'done') {
            finished = true;
            break;
          } else if (parsed.event === 'error') {
            appendAssistant((m) => ({ ...m, content: m.content + `[错误] ${parsed.data.error}` }));
            finished = true;
            break;
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const i = next.length - 1;
        if (i >= 0) next[i].content += `[网络异常]`;
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <ChatSidebar />
      <main className="flex flex-col flex-1 h-full min-w-0" style={{ color: 'var(--text)' }}>
        <ChatHeader
          models={models}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
        />

        {/* 中间：真正的聊天列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <ChatList messages={messages} loading={loading} />
        </div>

        {/* 底部：真正的输入框 */}
        <div
          className="px-4 py-4"
          style={{ borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg-deep)' }}
        >
          <ChatInput onSend={handleSend} loading={loading} />
        </div>
      </main>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
