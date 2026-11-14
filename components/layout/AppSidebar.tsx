'use client';

import { exportSessionMarkdown } from '@/lib/history/export';
import type { SessionMeta } from '@/lib/history/types';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useChatStore } from '@/store/useChatStore';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const NAV_ITEMS = [
  { name: '单题对话', path: '/chat', icon: '💬' },
  { name: '批量诊断', path: '/diagnose', icon: '📁' },
  { name: '本地能力', path: '/local', icon: '🧩' },
];

/** 列表里的时间：今天只显示时分，其余显示月/日，避免占宽又读不出信息 */
function formatUpdatedAt(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 侧栏内部内容：桌面挤占式与移动抽屉共用同一份 markup */
function SidebarContent() {
  const { toggleSidebar } = useChatStore();
  const pathname = usePathname();
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const historySupported = useChatStore((s) => s.historySupported);
  const openSession = useChatStore((s) => s.openSession);
  const startNewChat = useChatStore((s) => s.startNewChat);
  const removeSession = useChatStore((s) => s.removeSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const refreshSessions = useChatStore((s) => s.refreshSessions);
  const isMobile = useMediaQuery('(max-width: 767px)');

  // 改名态：只允许一条进入编辑；草稿与提交分开，Esc 取消不写库（§8.1）
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  /** Esc 取消时 input 会跟着失焦，用它压掉 blur 的提交 */
  const cancelRenameRef = useRef(false);

  // 列表首次挂载即刷新（§7.4）：store 快照原本只在 /chat 的 useChat 里刷，直接进
  // /diagnose、/local 时快照为空，列表会整体空转，故收口到侧栏自身挂载
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const handleOpen = useCallback(
    (id: string) => {
      openSession(id);
      if (isMobile) setSidebarOpen(false);
    },
    [openSession, isMobile, setSidebarOpen]
  );

  const handleNewChat = useCallback(() => {
    startNewChat();
    if (isMobile) setSidebarOpen(false);
  }, [startNewChat, isMobile, setSidebarOpen]);

  const handleDelete = useCallback(
    async (meta: SessionMeta) => {
      // 删除不可恢复，必须先确认；确认后由 store 负责「先切断归属再删库」
      if (!window.confirm(`删除会话「${meta.title}」？删除后不可恢复。`)) return;
      await removeSession(meta.id);
    },
    [removeSession]
  );

  /** 导出为 Markdown：读库里已落盘快照（§8.2）；读不到说明会话已被删，明确告知而不是静默 */
  const handleExport = useCallback(async (meta: SessionMeta) => {
    const ok = await exportSessionMarkdown(meta);
    if (!ok) window.alert('该会话内容已不存在，无法导出。');
  }, []);

  const beginRename = useCallback((meta: SessionMeta) => {
    cancelRenameRef.current = false;
    setRenamingId(meta.id);
    setDraftTitle(meta.title);
  }, []);

  const cancelRename = useCallback(() => {
    cancelRenameRef.current = true;
    setRenamingId(null);
    setDraftTitle('');
  }, []);

  const commitRename = useCallback(async () => {
    const id = renamingId;
    if (!id) return;
    const title = draftTitle;
    setRenamingId(null);
    setDraftTitle('');
    // 空标题 / 与原值相同由 store 判掉（返回 false），这里不需要额外提示
    await renameSession(id, title);
  }, [draftTitle, renamingId, renameSession]);

  return (
    <div className="flex flex-col h-full w-64">
      {/* 宽度固定为 w-64，防止收起动画时内部元素被挤压变形 */}
      <div className="h-14 flex items-center justify-between px-4 shrink-0">
        <Link href="/" className="flex items-center gap-2 font-bold text-sm tracking-tight">
          <span className="text-lg">🧠</span>
          <span>Notesync</span>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="h-8 w-8 text-muted-foreground hover:bg-muted touch:h-11 touch:w-11"
          title="收起侧边栏"
        >
          <svg
            className="w-[18px] h-[18px]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={1.5} />
            <path d="M9 3v18" strokeWidth={1.5} />
          </svg>
        </Button>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-6 overflow-y-auto">
        {/* 导航区 */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2">功能导航</h3>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.path);
              return (
                <Link key={item.path} href={item.path} className="block">
                  <Button
                    variant={isActive ? 'secondary' : 'ghost'}
                    className={`w-full justify-start gap-3 h-9 touch:h-11 ${isActive ? 'bg-background shadow-sm border border-border/50' : ''}`}
                  >
                    <span className="text-base">{item.icon}</span>
                    <span className="text-sm">{item.name}</span>
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* 历史记录区 */}
        <div className="mt-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground">最近记录</h3>
            <button
              type="button"
              onClick={handleNewChat}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="新建对话（当前会话会先保存）"
            >
              + 新建
            </button>
          </div>

          {historySupported ? null : (
            <p className="mb-2 rounded-md bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
              当前浏览器不支持本地保存，本次对话不会留存
            </p>
          )}

          {sessions.length === 0 ? (
            <div className="px-3 text-sm italic text-muted-foreground">暂无历史会话</div>
          ) : (
            <ul className="space-y-0.5">
              {sessions.map((item) => {
                const active = item.id === currentSessionId;
                return (
                  <li key={item.id} className="group relative">
                    {renamingId === item.id ? (
                      <input
                        autoFocus
                        value={draftTitle}
                        maxLength={60}
                        aria-label="会话标题"
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onFocus={() => {
                          cancelRenameRef.current = false;
                        }}
                        onBlur={() => {
                          // Esc 已经取消过就不再提交（元素移除时部分浏览器仍会派发 blur）
                          if (cancelRenameRef.current) return;
                          void commitRename();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void commitRename();
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                        title="回车保存，Esc 取消；留空则放弃改名"
                        className="w-full rounded-lg border border-border/50 bg-background py-1.5 pl-3 pr-2 text-sm outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpen(item.id)}
                        title={item.title}
                        className={`flex w-full items-center gap-2 rounded-lg py-1.5 pl-3 pr-20 text-left transition-colors ${
                          active
                            ? 'bg-background shadow-sm border border-border/50'
                            : 'border border-transparent hover:bg-muted/60'
                        }`}
                      >
                        <span className="flex-1 truncate text-sm">{item.title}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatUpdatedAt(item.updatedAt)}
                        </span>
                      </button>
                    )}
                    {renamingId === item.id ? null : (
                      // 三个动作按钮：桌面 hover / 键盘聚焦才显形，触屏常显（doc/mobile-ux.md §4）
                      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100">
                        <button
                          type="button"
                          onClick={() => beginRename(item)}
                          title="重命名会话"
                          aria-label={`重命名会话 ${item.title}`}
                          className="rounded p-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleExport(item)}
                          title="导出为 Markdown"
                          aria-label={`导出会话 ${item.title}`}
                          className="rounded p-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(item)}
                          title="删除会话"
                          aria-label={`删除会话 ${item.title}`}
                          className="rounded p-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AppSidebar() {
  const { isSidebarOpen, setSidebarOpen } = useChatStore();
  const pathname = usePathname();
  const isMobile = useMediaQuery('(max-width: 767px)');

  // 移动端路由切换自动收起抽屉；桌面保持开合跨路由不变。
  // 用 ref 记上次路径：mount 时不视为"切换"，避免与 hydrateUI 恢复状态竞态（doc/mobile-ux.md §2）
  const seenPath = useRef(pathname);
  useEffect(() => {
    if (!isMobile) return;
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    setSidebarOpen(false);
  }, [pathname, isMobile, setSidebarOpen]);

  // 移动端：overlay 抽屉覆盖内容，不挤占（swipeDirection=left 即左侧贴边，向左滑关闭）
  if (isMobile) {
    return (
      <Drawer open={isSidebarOpen} onOpenChange={setSidebarOpen} swipeDirection="left">
        <DrawerContent
          className="[--drawer-inset:0px] [--drawer-content-width:16rem] max-w-[75%] rounded-none border-y-0 border-l-0 bg-background data-[swipe-axis=x]:[--drawer-content-width:16rem] data-[swipe-axis=x]:sm:[--drawer-content-width:16rem]"
        >
          <DrawerTitle className="sr-only">导航菜单</DrawerTitle>
          <SidebarContent />
        </DrawerContent>
      </Drawer>
    );
  }

  // 桌面端：维持原有挤占式（w-64 / w-0 过渡）
  return (
    <aside
      className={`flex flex-col h-full bg-muted/10 border-r border-border transition-all duration-300 ease-in-out shrink-0 overflow-hidden
        ${isSidebarOpen ? 'w-64' : 'w-0 border-r-0'}`}
    >
      <SidebarContent />
    </aside>
  );
}
