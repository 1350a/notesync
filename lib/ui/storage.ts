/**
 * 会话级 UI 偏好 - 存储抽象与实现。
 *
 * 与 lib/settings/storage.ts 同款模式：接口与实现分离、window 守卫、失败静默降级。
 * 无用户系统，仅本机 localStorage，单 flag 记录（桌面/移动共用，doc/mobile-ux.md §2）。
 */

export const UI_STORAGE_KEY = 'notesync-ui.v1';

export interface UIState {
  sidebarOpen: boolean;
}

export interface UIStorage {
  /** 读取 UI 偏好；缺失/损坏一律回落默认值，不抛错 */
  load(): UIState;
  /** 持久化 UI 偏好；尽力而为（配额/隐私模式失败仅 console.warn），不影响内存态 */
  save(state: UIState): void;
}

const DEFAULT_UI_STATE: UIState = { sidebarOpen: false };

/** 未知数据收窄：只接受布尔 sidebarOpen，其余字段丢弃 */
function normalizeUIState(raw: unknown): UIState {
  if (raw && typeof raw === 'object' && 'sidebarOpen' in raw) {
    const value = (raw as { sidebarOpen?: unknown }).sidebarOpen;
    if (typeof value === 'boolean') return { sidebarOpen: value };
  }
  return DEFAULT_UI_STATE;
}

export function createLocalStorageUIStorage(): UIStorage {
  return {
    load() {
      // client 模块在 SSR 时也会被求值，函数体内必须守卫 window
      if (typeof window === 'undefined') return DEFAULT_UI_STATE;
      try {
        const raw = window.localStorage.getItem(UI_STORAGE_KEY);
        if (!raw) return DEFAULT_UI_STATE;
        return normalizeUIState(JSON.parse(raw));
      } catch {
        // 损坏数据（JSON 解析失败等）按缺失处理，不阻塞应用启动
        return DEFAULT_UI_STATE;
      }
    },
    save(state) {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        // 隐私模式/配额满：内存态仍然生效，仅持久化失败
        console.warn('[ui] 侧栏状态持久化失败（隐私模式或存储配额不足？）', err);
      }
    },
  };
}
