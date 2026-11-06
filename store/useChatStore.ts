import { create } from 'zustand';

interface ChatState {
  isDarkMode: boolean;
  isSettingsOpen: boolean;
  isSidebarOpen: boolean;
  toggleTheme: () => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  isDarkMode: false,
  isSettingsOpen: false,
  isSidebarOpen: true, // 默认展开

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
}));
