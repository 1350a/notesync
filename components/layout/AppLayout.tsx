'use client';

import SettingsModal from '@/components/SettingsModal';
import { useChatStore } from '@/store/useChatStore';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { sidebarPosition, isSettingsOpen, setSettingsOpen } = useChatStore();

  return (
    // 注意看这里：如果是右侧，用 flex-row-reverse 直接反转布局！
    <div
      className={`flex h-screen w-full overflow-hidden bg-background ${sidebarPosition === 'right' ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* 侧边栏 */}
      <AppSidebar />

      {/* 右侧/左侧 主内容区 */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* 这里复用你写好的全局吸顶顶栏 */}
        <AppHeader />

        {/* 页面具体内容 */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* 全局弹窗 */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
