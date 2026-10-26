"use client";

import type { Conversation } from "@/lib/types";
import ThemeSwitcher from "@/components/ThemeSwitcher";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

/**
 * 左侧会话列表栏：展示全部会话（对话分支），支持新建/切换/删除；
 * 底部提供主题切换入口（暗色/浅绿/浅蓝）。
 */
export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  collapsed = false,
  onToggle,
}: SidebarProps) {
  return (
    <aside
      className={`flex h-full flex-col border-r border-[var(--border)] bg-[var(--bg-deep)] transition-all duration-300 ${
        collapsed ? "w-14" : "w-64"
      }`}
    >
      {/* 顶部：新建会话 + 折叠按钮 */}
      <div className="flex items-center gap-2 p-3">
        <button
          onClick={onNew}
          title="新建会话"
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-text)] transition hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          {!collapsed && <span>新建会话</span>}
        </button>
        {onToggle && (
          <button
            onClick={onToggle}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            className="rounded-lg p-2 text-[var(--text-secondary)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {collapsed ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 5l7 7-7 7M5 5l7 7-7 7"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                />
              )}
            </svg>
          </button>
        )}
      </div>

      {/* 会话列表 */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {conversations.length === 0 && !collapsed && (
          <p className="px-2 py-6 text-center text-sm text-[var(--text-muted)]">
            还没有会话
            <br />
            点击「新建会话」开始
          </p>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center gap-2 rounded-xl px-2 py-2 transition ${
              conv.id === activeId
                ? "bg-[var(--accent-soft)] text-[var(--text)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
          >
            <button
              onClick={() => onSelect(conv.id)}
              title={conv.title}
              className="min-w-0 flex-1 truncate text-left text-sm"
            >
              {collapsed ? "💬" : conv.title}
            </button>
            {!collapsed && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                title="删除会话"
                className="rounded-md p-1 text-[var(--text-muted)] opacity-0 transition hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            )}
          </div>
        ))}
      </nav>

      {/* 底部：主题切换 + 提示 */}
      {!collapsed ? (
        <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2.5">
          <ThemeSwitcher />
          <p className="text-[10px] text-[var(--text-muted)]">本地保存</p>
        </div>
      ) : (
        <div className="border-t border-[var(--border)] py-2.5">
          <ThemeSwitcher collapsed />
        </div>
      )}
    </aside>
  );
}
