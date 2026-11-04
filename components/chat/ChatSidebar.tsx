'use client';

import { useChatStore } from '@/store/useChatStore';

export default function ChatSidebar() {
  const { isSidebarOpen, toggleSidebar } = useChatStore();

  return (
    <aside
      className={`flex flex-col h-full transition-all duration-300 ease-in-out shrink-0 border-r ${
        isSidebarOpen ? 'w-64' : 'w-0 overflow-hidden border-r-0'
      }`}
      style={{ backgroundColor: 'var(--bg-deep)', borderColor: 'var(--border)' }}
    >
      <div className="p-4 flex flex-col gap-4 h-full">
        <button
          className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:opacity-90"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-text)' }}
        >
          + 新建对话
        </button>

        <div className="flex-1 overflow-y-auto space-y-1 mt-2">
          {/* 这里未来渲染历史记录列表 */}
          <div
            className="px-3 py-2 text-sm rounded-lg cursor-pointer"
            style={{ backgroundColor: 'var(--panel-soft)' }}
          >
            <span className="truncate block">未命名对话 1</span>
          </div>
          <div
            className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-black/5"
            style={{ color: 'var(--text-muted)' }}
          >
            <span className="truncate block">历史对话 2</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
