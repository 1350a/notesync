import { create } from 'zustand';

interface ChatState {
  isDarkMode: boolean;
  isSettingsOpen: boolean;
  isSidebarOpen: boolean;
  sidebarPosition: 'left' | 'right';
  toggleTheme: () => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleSidebarPosition: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  isDarkMode: false,
  isSettingsOpen: false,
  isSidebarOpen: true,
  sidebarPosition: 'left', // 默认为左

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
  toggleSidebarPosition: () =>
    set((state) => ({
      sidebarPosition: state.sidebarPosition === 'left' ? 'right' : 'left',
    })),
}));
