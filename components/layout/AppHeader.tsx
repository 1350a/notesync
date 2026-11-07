'use client';

import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/useChatStore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AppHeader() {
  const {
    toggleTheme,
    isDarkMode,
    setSettingsOpen,
    isSidebarOpen,
    toggleSidebar,
    startNewChat,
  } = useChatStore();
  const router = useRouter();

  // 新建对话：清空当前会话并回到对话页
  const handleNewChat = () => {
    startNewChat();
    router.push('/chat');
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between px-3">
        {/* 左侧区域 */}
        <div className="flex items-center gap-2">
          {/* 只有当侧边栏收起时，才在左侧显示展开按钮和 Logo 组 */}
          {!isSidebarOpen && (
            <div className="flex items-center animate-in fade-in slide-in-from-left-2 duration-200">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="h-8 w-8 text-muted-foreground hover:bg-muted"
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
                className="flex items-center gap-2 font-bold text-sm tracking-tight ml-2 mr-2"
              >
                <span className="text-lg">🧠</span>
                <span>Notesync</span>
              </Link>

              <div className="flex items-center gap-1 border-l border-border/60 pl-2">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled
                  className="h-8 w-8 text-muted-foreground opacity-50 cursor-not-allowed"
                  title="搜索尚未接入：当前没有可检索的历史会话数据"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNewChat}
                  className="h-8 w-8 text-muted-foreground"
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

        {/* 右侧操作区 */}
        <div className="flex items-center gap-2 pr-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            title="切换主题"
            className="h-8 w-8"
          >
            {isDarkMode ? '☀️' : '🌙'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            title="系统设置"
            className="h-8 w-8"
          >
            ⚙️
          </Button>
        </div>
      </div>
    </header>
  );
}
