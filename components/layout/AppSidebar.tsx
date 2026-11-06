'use client';

import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/useChatStore';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AppSidebar() {
  const { isSidebarOpen, toggleSidebarPosition } = useChatStore();
  const pathname = usePathname();

  // 如果折叠了，就不渲染内容（宽度交给外层控制）
  if (!isSidebarOpen) return null;

  const navItems = [
    { name: '单题对话', path: '/chat', icon: '💬' },
    { name: '批量诊断', path: '/diagnose', icon: '📁' },
  ];

  return (
    <aside className="w-64 h-full flex flex-col bg-black/10 border-r border-border shrink-0">
      {/* 导航区 */}
      <div className="p-4 flex-1 space-y-6">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
            功能导航
          </h3>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.path);
              return (
                <Link key={item.path} href={item.path} className="block">
                  <Button
                    variant={isActive ? 'secondary' : 'ghost'}
                    className={`w-full justify-start gap-3 ${isActive ? 'bg-background shadow-sm' : ''}`}
                  >
                    <span className="text-lg">{item.icon}</span>
                    {item.name}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* 历史记录区 (占位) */}
        <div className="pt-4 border-t border-border/50">
          <h3 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
            最近记录
          </h3>
          <div className="text-sm text-muted-foreground italic px-3">（对话历史将在后续接入）</div>
        </div>
      </div>

      {/* 底部操作区 */}
      <div className="p-4 border-t border-border">
        <Button variant="outline" className="w-full text-xs" onClick={toggleSidebarPosition}>
          🔄 切换侧栏到右侧
        </Button>
      </div>
    </aside>
  );
}
