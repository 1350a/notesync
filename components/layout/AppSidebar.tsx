'use client';

import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/useChatStore';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AppSidebar() {
  const { isSidebarOpen, toggleSidebar } = useChatStore();
  const pathname = usePathname();

  const navItems = [
    { name: '单题对话', path: '/chat', icon: '💬' },
    { name: '批量诊断', path: '/diagnose', icon: '📁' },
  ];

  return (
    <aside
      className={`flex flex-col h-full bg-muted/10 border-r border-border transition-all duration-300 ease-in-out shrink-0 overflow-hidden
        ${isSidebarOpen ? 'w-64' : 'w-0 border-r-0'}`}
    >
      {/* 宽度固定为 w-64，防止收起动画时内部元素被挤压变形 */}
      <div className="w-64 flex flex-col h-full">
        {/* 顶部：Logo + 侧栏收起按钮 */}
        <div className="h-14 flex items-center justify-between px-4 shrink-0">
          <Link href="/" className="flex items-center gap-2 font-bold text-sm tracking-tight">
            <span className="text-lg">🧠</span>
            <span>Notesync</span>
          </Link>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="h-8 w-8 text-muted-foreground hover:bg-muted"
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
              placeholder="搜索..."
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-background border border-border rounded-lg outline-none focus:border-ring focus:ring-1 focus:ring-ring/30 transition-all placeholder:text-muted-foreground"
            />
          </div>

          {/* 导航区 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">功能导航</h3>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const isActive = pathname.startsWith(item.path);
                return (
                  <Link key={item.path} href={item.path} className="block">
                    <Button
                      variant={isActive ? 'secondary' : 'ghost'}
                      className={`w-full justify-start gap-3 h-9 ${isActive ? 'bg-background shadow-sm border border-border/50' : ''}`}
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
    </aside>
  );
}
