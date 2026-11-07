import { create } from 'zustand';

interface ChatState {
  isDarkMode: boolean;
  isSettingsOpen: boolean;
  isSidebarOpen: boolean;
  /** 新建对话信号：每次递增，聊天页监听变化后清空当前会话 */
  newChatSignal: number;
  toggleTheme: () => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  startNewChat: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  isDarkMode: false,
  isSettingsOpen: false,
  isSidebarOpen: true, // 默认展开
  newChatSignal: 0,

  toggleTheme: () => {
    const nextDark = !get().isDarkMode;
    if (typeof document !== 'undefined') {
      if (nextDark) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    }
    set({ isDarkMode: nextDark });
  },

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  startNewChat: () => set((state) => ({ newChatSignal: state.newChatSignal + 1 })),
}));
