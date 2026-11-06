'use client';

import { Button } from '@/components/ui/button';
import { useChatStore } from '@/store/useChatStore';
import Link from 'next/link';

export default function AppHeader() {
  const { toggleTheme, isDarkMode, setSettingsOpen } = useChatStore();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between px-6 max-w-7xl mx-auto">
        {/* 左侧 Logo */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <span className="text-2xl">🧠</span>
            <span>Notesync</span>
          </Link>
          <nav className="hidden md:flex items-center gap-4 text-sm font-medium text-muted-foreground">
            <Link href="/chat" className="hover:text-foreground transition-colors">
              单题对话
            </Link>
            <Link href="/diagnose" className="hover:text-foreground transition-colors">
              批量诊断
            </Link>
          </nav>
        </div>

        {/* 右侧操作区 */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleTheme} title="切换主题">
            {isDarkMode ? '☀️' : '🌙'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            title="系统设置"
          >
            ⚙️
          </Button>
        </div>
      </div>
    </header>
  );
}
