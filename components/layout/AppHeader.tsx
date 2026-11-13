'use client';

import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/useChatStore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AppHeader() {
  const { setSettingsOpen, isSidebarOpen, toggleSidebar, startNewChat } = useChatStore();
  const router = useRouter();

  // 新建对话：清空当前会话并回到对话页
  const handleNewChat = () => {
    startNewChat();
    router.push('/chat');
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between px-3">
        {/* 左侧区域：min-w-0 让本区在窄屏可收缩，避免把右侧操作组顶出视口（doc/mobile-ux.md §7） */}
        <div className="flex min-w-0 items-center gap-2">
          {/* 只有当侧边栏收起时，才在左侧显示展开按钮和 Logo 组 */}
          {!isSidebarOpen && (
            <div className="flex min-w-0 items-center animate-in fade-in slide-in-from-left-2 duration-200">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="touch:h-11 touch:w-11 h-8 w-8 text-muted-foreground hover:bg-muted"
                title="展开侧边栏"
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

              <Link
                href="/"
                className="flex min-w-0 items-center gap-2 font-bold text-sm tracking-tight ml-2 mr-2"
              >
                <span className="text-lg">🧠</span>
                <span className="truncate">Notesync</span>
              </Link>

              <div className="flex items-center gap-1 border-l border-border/60 pl-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNewChat}
                  className="touch:h-11 touch:w-11 h-8 w-8 text-muted-foreground"
                  title="新建对话（清空当前会话）"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M12 5v14M5 12h14"
                    />
                  </svg>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧操作区：shrink-0 保证 44px 触控热区不被左侧挤压（doc/mobile-ux.md §4/§7） */}
        <div className="flex shrink-0 items-center gap-2 pr-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            title="系统设置"
            className="touch:h-11 touch:w-11 h-8 w-8"
          >
            ⚙️
          </Button>
        </div>
      </div>
    </header>
  );
}
