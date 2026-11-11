'use client';

import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useChatStore } from '@/store/useChatStore';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const NAV_ITEMS = [
  { name: '单题对话', path: '/chat', icon: '💬' },
  { name: '批量诊断', path: '/diagnose', icon: '📁' },
  { name: '本地能力', path: '/local', icon: '🧩' },
];

/** 侧栏内部内容：桌面挤占式与移动抽屉共用同一份 markup */
function SidebarContent() {
  const { toggleSidebar } = useChatStore();
  const pathname = usePathname();

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
            disabled
            placeholder="搜索（待接入：暂无历史会话数据）"
            title="搜索尚未接入：会话不做本地持久化，暂无检索数据源"
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-muted/40 border border-border rounded-lg outline-none cursor-not-allowed placeholder:text-muted-foreground/70"
          />
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
          <h3 className="text-xs font-semibold text-muted-foreground mb-2">最近记录</h3>
          <div className="text-sm text-muted-foreground italic px-3">
            （对话历史将在后续接入）
          </div>
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
