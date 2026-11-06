'use client';

import SettingsModal from '@/components/SettingsModal';
import { useChatStore } from '@/store/useChatStore';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isSettingsOpen, setSettingsOpen } = useChatStore();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar />

      <div className="flex flex-col flex-1 min-w-0 h-full">
        <AppHeader />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
