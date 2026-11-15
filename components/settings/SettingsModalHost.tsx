'use client';

import { applyTheme } from '@/lib/settings/theme';
import { useChatStore } from '@/store/useChatStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useEffect } from 'react';
import SettingsModal from './SettingsModal';

/**
 * 设置弹窗宿主：订阅 isSettingsOpen 并渲染弹窗。
 * 供不经过 AppLayout 的页面使用（首页 app/page.tsx 自带 AppHeader 但不在 (main) 路由组），
 * 否则顶栏 ⚙️ 的 setSettingsOpen 无消费方、点击无响应（doc/mobile-ux.md §7）。
 * 首页同样没有 AppLayout 这个主题唯一生效点：这里补上设置水合 + applyTheme 订阅
 * （与 AppLayout 同款），否则在首页改主题只写存储、不落 <html data-theme>。
 */
export default function SettingsModalHost() {
  const isSettingsOpen = useChatStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen);
  const theme = useSettingsStore((s) => s.settings.theme);
  const hydrate = useSettingsStore((s) => s.hydrate);

  // 挂载后从存储水合一次（幂等）：与 AppLayout 一致，消费方逻辑保持同构
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // 主题应用到 <html>：data-theme 决定色板，.dark 供 dark: variant 使用
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />;
}
