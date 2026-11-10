import { createLocalStorageUIStorage } from '@/lib/ui/storage.ts';
import { create } from 'zustand';

// 主题偏好已迁移至 useSettingsStore（持久化 + 三态），本 store 只留会话级 UI 态
interface ChatState {
  isSettingsOpen: boolean;
  isSidebarOpen: boolean;
  /** 新建对话信号：每次递增，聊天页监听变化后清空当前会话 */
  newChatSignal: number;
  setSettingsOpen: (open: boolean) => void;
  /** 侧栏开合统一入口：内存态与持久化原子同步（doc/mobile-ux.md §2） */
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** mount 后从存储恢复侧栏上次状态（首帧一律收起，避免 SSR hydration 闪烁） */
  hydrateUI: () => void;
  startNewChat: () => void;
}

const uiStorage = createLocalStorageUIStorage();

export const useChatStore = create<ChatState>((set) => ({
  isSettingsOpen: false,
  // 默认收起：SSR 与客户端首帧一致；上次状态由 hydrateUI 在 mount 后恢复（带过渡动画）
  isSidebarOpen: false,
  newChatSignal: 0,

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setSidebarOpen: (open) => {
    set({ isSidebarOpen: open });
    uiStorage.save({ sidebarOpen: open });
  },
  toggleSidebar: () =>
    set((state) => {
      const open = !state.isSidebarOpen;
      uiStorage.save({ sidebarOpen: open });
      return { isSidebarOpen: open };
    }),
  hydrateUI: () => {
    const { sidebarOpen } = uiStorage.load();
    if (sidebarOpen) set({ isSidebarOpen: true });
  },
  startNewChat: () => set((state) => ({ newChatSignal: state.newChatSignal + 1 })),
}));
