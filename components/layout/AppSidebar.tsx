'use client';

import type { ChatMsg } from '@/lib/chat/messages';
import {
  SEARCH_BODY_SCAN_LIMIT,
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIT_LIMIT,
  matchMessages,
  matchMeta,
  mergeHits,
  normalizeKeyword,
} from '@/lib/history/search';
import { getHistoryStorage } from '@/lib/history/storage';
import type { SessionMeta } from '@/lib/history/types';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useChatStore } from '@/store/useChatStore';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const isMobile = useMediaQuery('(max-width: 767px)');

  const [keyword, setKeyword] = useState('');
  const [hits, setHits] = useState<SessionMeta[]>([]);
  const [searching, setSearching] = useState(false);
  const query = normalizeKeyword(keyword);

  // 搜索：防抖 200ms；先标题过滤（零 IO），标题命中不足再逐条回读正文补齐。
  // 正文扫描上限 SEARCH_BODY_SCAN_LIMIT 条，命中够数或扫完即停（§7.4）
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const current = normalizeKeyword(keyword);
      if (!current) {
        setSearching(false);
        setHits(sessions);
        return;
      }
      const titleHits = sessions.filter((item) => matchMeta(item, current));
      setHits(titleHits.slice(0, SEARCH_HIT_LIMIT));
      const rest = sessions
        .filter((item) => !titleHits.includes(item))
        .slice(0, SEARCH_BODY_SCAN_LIMIT);
      if (titleHits.length >= SEARCH_HIT_LIMIT || rest.length === 0) {
        setSearching(false);
        return;
      }
      setSearching(true);
      void (async () => {
        const storage = getHistoryStorage();
        const bodyHits: SessionMeta[] = [];
        for (const item of rest) {
          if (cancelled) return;
          if (titleHits.length + bodyHits.length >= SEARCH_HIT_LIMIT) break;
          const record = await storage.loadSession(item.id);
          if (record && matchMessages(record.messages as ChatMsg[], current)) bodyHits.push(item);
        }
        if (cancelled) return;
        setSearching(false);
        setHits(mergeHits(titleHits, bodyHits));
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [keyword, sessions]);

  // 无关键词时直接吃 store 快照，避免首帧先摆空列表再被搜索结果覆盖
  const list = useMemo(() => (query ? hits : sessions), [query, hits, sessions]);

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
        {/* 搜索框 (修复了之前只有放大镜没有输入框的问题) */}
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            disabled={!historySupported}
            placeholder={historySupported ? '搜索会话标题与内容' : '当前环境不支持本地保存'}
            title={
              historySupported
                ? '子串匹配会话标题与消息正文，最多显示 50 条'
                : '当前浏览器不支持本地保存，没有可检索的历史会话'
            }
            className={`w-full pl-9 pr-3 py-1.5 text-sm bg-muted/40 border border-border rounded-lg outline-none ${
              historySupported
                ? 'focus:border-foreground/30 placeholder:text-muted-foreground/70'
                : 'cursor-not-allowed placeholder:text-muted-foreground/70'
            }`}
          />
          {searching ? (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
              搜索中
            </span>
          ) : null}
        </div>

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

          {list.length === 0 ? (
            <div className="px-3 text-sm italic text-muted-foreground">
              {query ? (searching ? '搜索中…' : '没有匹配的会话') : '暂无历史会话'}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {list.map((item) => {
                const active = item.id === currentSessionId;
                return (
                  <li key={item.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => handleOpen(item.id)}
                      title={item.title}
                      className={`flex w-full items-center gap-2 rounded-lg py-1.5 pl-3 pr-8 text-left transition-colors ${
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
                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      title="删除会话"
                      aria-label={`删除会话 ${item.title}`}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      ×
                    </button>
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
