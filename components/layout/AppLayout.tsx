'use client';

import SettingsModal from '@/components/settings/SettingsModal';
import { isDarkEffective, watchSystemTheme } from '@/lib/settings/theme';
import { useChatStore } from '@/store/useChatStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useEffect } from 'react';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isSettingsOpen, setSettingsOpen, hydrateUI } = useChatStore();
  // 设置水合与主题应用收口在布局层：全站唯一生效点，各页不再自行处理
  const theme = useSettingsStore((s) => s.settings.theme);
  const hydrate = useSettingsStore((s) => s.hydrate);

  // 客户端挂载后从存储水合一次（幂等）：设置 + 侧栏开合记忆（doc/mobile-ux.md §2）
  useEffect(() => {
    hydrate();
    hydrateUI();
  }, [hydrate, hydrateUI]);

  // 主题应用到 <html>；'system' 时订阅系统深浅色变化实时联动
  useEffect(() => {
    const apply = () => {
      if (isDarkEffective(theme)) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    };
    apply();
    if (theme !== 'system') return;
    return watchSystemTheme(apply);
  }, [theme]);

  // dvh 而非 vh：移动浏览器动态工具栏下 100vh ≠ 可视高度（doc/mobile-ux.md §1）
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <AppSidebar />

      <div className="flex flex-col flex-1 min-w-0 h-full">
        <AppHeader />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
