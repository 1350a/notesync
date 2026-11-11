'use client';

import { useChatStore } from '@/store/useChatStore';
import SettingsModal from './SettingsModal';

/**
 * 设置弹窗宿主：订阅 isSettingsOpen 并渲染弹窗。
 * 供不经过 AppLayout 的页面使用（首页 app/page.tsx 自带 AppHeader 但不在 (main) 路由组），
 * 否则顶栏 ⚙️ 的 setSettingsOpen 无消费方、点击无响应（doc/mobile-ux.md §7）。
 */
export default function SettingsModalHost() {
  const isSettingsOpen = useChatStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen);

  return <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />;
}
