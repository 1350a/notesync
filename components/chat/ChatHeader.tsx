'use client';

import { useChatStore } from '@/store/useChatStore';

// 定义 Props 类型，替代 any
interface ChatHeaderProps {
  models: { name: string; model: string }[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
}

export default function ChatHeader({ models, selectedModel, onSelectModel }: ChatHeaderProps) {
  const { theme, toggleTheme, setSettingsOpen, toggleSidebar } = useChatStore();

  return (
    <header
      className="flex items-center justify-between px-6 py-3 shadow-sm z-10 relative"
      style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-deep)' }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg hover:bg-black/5 transition-colors text-xl leading-none"
          title="展开/收起侧边栏"
        >
          ☰
        </button>
        <span className="text-xl">🧠</span>
        <div>
          <h1 className="text-sm font-semibold">错题认知诊断引擎</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            交互体验重构版
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <select
          value={selectedModel}
          onChange={(e) => onSelectModel(e.target.value)}
          className="rounded-xl px-3 py-1.5 text-xs outline-none cursor-pointer"
          style={{
            border: '1px solid var(--border)',
            backgroundColor: 'var(--panel-soft)',
            color: 'var(--text)',
          }}
        >
          {models.length === 0 && <option value="">未配置模型</option>}
          {/* 这里加了具体的类型 { name: string; model: string } */}
          {models.map((m: { name: string; model: string }) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>

        <button
          onClick={toggleTheme}
          className="p-2 text-lg rounded-full hover:bg-black/5 transition-colors"
          title="切换主题"
        >
          {theme === 'dark' ? '🌙' : theme === 'green' ? '🌿' : '🌊'}
        </button>

        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 text-lg rounded-full hover:bg-black/5 transition-colors"
          title="打开设置"
        >
          ⚙️
        </button>
      </div>
    </header>
  );
}
