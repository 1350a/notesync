import { create } from 'zustand';
import { createLocalStorageSettingsStorage } from '@/lib/settings/storage.ts';
import type { SettingsStorage } from '@/lib/settings/storage.ts';
import { cloneDefaults } from '@/lib/settings/types.ts';
import type { UserSettings } from '@/lib/settings/types.ts';

interface SettingsState {
  /** 当前设置；水合前为默认值 */
  settings: UserSettings;
  /** 是否已从存储水合（避免 SSR 首帧与本地数据竞态；消费方在 hydrated 前不应回写） */
  hydrated: boolean;
  /** 从存储加载（客户端挂载后调用一次，幂等） */
  hydrate: () => void;
  /** 浅合并更新并持久化；嵌套对象（generation/ocr）为整体替换 */
  update: (patch: Partial<UserSettings>) => void;
  /** 恢复默认设置（清持久化 + 内存回默认） */
  reset: () => void;
}

/**
 * 进程内单例存储实例：消费方不感知具体实现（协议 doc/user-settings.md §3），
 * 将来换服务端存储只改这一行。
 */
const storage: SettingsStorage = createLocalStorageSettingsStorage();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: cloneDefaults(),
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ settings: storage.load(), hydrated: true });
  },

  update: (patch) => {
    const next: UserSettings = { ...get().settings, ...patch };
    storage.save(next);
    // 持久化失败（配额/隐私模式）不影响内存态：本次会话内设置仍然生效
    set({ settings: next });
  },

  reset: () => {
    storage.clear();
    set({ settings: cloneDefaults() });
  },
}));
