import { create } from 'zustand';

interface ChatState {
  theme: 'light' | 'dark';
  isSettingsOpen: boolean;
  isSidebarOpen: boolean;
  toggleTheme: () => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  theme: 'light',
  isSettingsOpen: false,
  isSidebarOpen: true, // 默认展开侧边栏
  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', newTheme);
      }
      return { theme: newTheme };
    }),
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}));
