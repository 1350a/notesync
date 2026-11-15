/**
 * 用户设置 - 存储抽象与实现。
 *
 * 消费方（store/组件）只依赖 SettingsStorage 接口；当前实现为浏览器 localStorage，
 * 将来换服务端存储时仅替换实现、不改消费方（协议见 doc/user-settings.md §3）。
 * 导入统一带 .ts 后缀：与 lib/tools 同款约定，保证 scripts/ 冒烟可零依赖直跑。
 */
import { normalizeSettings } from './types.ts';
import type { UserSettings } from './types.ts';

export const SETTINGS_STORAGE_KEY = 'notesync-settings.v1';
/** 存储结构版本号：仅作标识，当前合并策略统一走 normalize（未知字段丢弃 + 默认合并） */
export const SETTINGS_STORAGE_VERSION = 1;

export interface SettingsStorage {
  /** 读取并规整设置；缺失/损坏一律回落默认值，不抛错 */
  load(): UserSettings;
  /** 持久化设置；尽力而为（配额/隐私模式失败仅 console.warn），不影响内存态 */
  save(settings: UserSettings): void;
  /** 清除已持久化的设置 */
  clear(): void;
}

/** 独立默认值副本（嵌套对象不共享），load 空数据时返回 */
function snapshotDefaults(): UserSettings {
  return normalizeSettings(null);
}

export function createLocalStorageSettingsStorage(): SettingsStorage {
  return {
    load() {
      // client 模块在 SSR 时也会被求值，函数体内必须守卫 window
      if (typeof window === 'undefined') return snapshotDefaults();
      try {
        const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return snapshotDefaults();
        return normalizeSettings(JSON.parse(raw));
      } catch {
        // 损坏数据（JSON 解析失败等）按缺失处理，不阻塞应用启动
        return snapshotDefaults();
      }
    },
    save(settings) {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(
          SETTINGS_STORAGE_KEY,
          JSON.stringify({ version: SETTINGS_STORAGE_VERSION, ...settings })
        );
      } catch (err) {
        // 隐私模式/配额满：内存态仍然生效，仅持久化失败
        console.warn('[settings] 设置持久化失败（隐私模式或存储配额不足？）', err);
      }
    },
    clear() {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      } catch {
        // 同 save：读不到/删不掉不致命，内存态兜底
      }
    },
  };
}

/** 内存实现：冒烟测试用，也作为将来 SSR/服务端存储的参照契约 */
export function createMemorySettingsStorage(initial?: UserSettings): SettingsStorage {
  let current = normalizeSettings(initial ?? null);
  return {
    load: () => normalizeSettings(JSON.parse(JSON.stringify(current))),
    save: (settings) => {
      current = normalizeSettings(settings);
    },
    clear: () => {
      current = snapshotDefaults();
    },
  };
}
