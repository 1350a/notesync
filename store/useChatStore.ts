import { create } from 'zustand';

// 主题偏好已迁移至 useSettingsStore（持久化 + 三态），本 store 只留会话级 UI 态
interface ChatState {
  isSettingsOpen: boolean;
  isSidebarOpen: boolean;
  /** 新建对话信号：每次递增，聊天页监听变化后清空当前会话 */
  newChatSignal: number;
  setSettingsOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  startNewChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  isSettingsOpen: false,
  isSidebarOpen: true, // 默认展开
  newChatSignal: 0,

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  startNewChat: () => set((state) => ({ newChatSignal: state.newChatSignal + 1 })),
}));
