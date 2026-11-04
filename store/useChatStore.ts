import { create } from 'zustand';

interface ChatState {
  theme: 'light' | 'dark';
  isSettingsOpen: boolean;
  toggleTheme: () => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  theme: 'light', // 默认浅色
  isSettingsOpen: false, // 默认关闭设置弹窗
  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      // 顺手把浏览器的 data-theme 属性改了，为了以后接 CSS 变量
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', newTheme);
      }
      return { theme: newTheme };
    }),
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
}));
