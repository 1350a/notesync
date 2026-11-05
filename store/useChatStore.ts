import { ThemeKey, applyTheme, initTheme } from '@/lib/theme';
import { create } from 'zustand';

interface ChatState {
  theme: ThemeKey;
  isSettingsOpen: boolean;
  isSidebarOpen: boolean;
  toggleTheme: () => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  initTheme: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // 默认给个 dark，初始化时会被覆盖
  theme: 'dark',
  isSettingsOpen: false,
  isSidebarOpen: true,

  // 点击时，在三种主题间循环切换
  toggleTheme: () => {
    const current = get().theme;
    let next: ThemeKey = 'dark';
    if (current === 'dark') next = 'green';
    else if (current === 'green') next = 'blue';
    else next = 'dark';

    applyTheme(next); // 调用遗留代码里的完美应用函数
    set({ theme: next });
  },

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  // 初始化时，读取本地存储的主题
  initTheme: () => {
    const savedTheme = initTheme();
    set({ theme: savedTheme });
  },
}));
