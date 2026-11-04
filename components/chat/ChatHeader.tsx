'use client';

import { useChatStore } from '@/store/useChatStore';

export default function ChatHeader({
  models,
  selectedModel,
  onSelectModel,
}: {
  models: { name: string; model: string }[];
  selectedModel: string;

  onSelectModel: (m: string) => void;
}) {
  const { theme, toggleTheme, setSettingsOpen } = useChatStore();

  return (
    <header
      className="flex items-center justify-between px-6 py-3 shadow-sm z-10 relative"
      style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-deep)' }}
    >
      <div className="flex items-center gap-3">
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
          {models.map((m) => (
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
          {theme === 'light' ? '🌙' : '☀️'}
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
