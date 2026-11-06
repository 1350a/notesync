// /**
//  * 错题认知诊断引擎 - 主题管理工具
//  * 支持暗色/浅绿/浅蓝三套主题，localStorage 持久化，刷新后保持选择。
//  */

// export type ThemeKey = "dark" | "green" | "blue";

// export interface ThemeOption {
//   key: ThemeKey;
//   label: string;
//   /** 主题代表色（用于切换按钮色块） */
//   color: string;
// }

// /** localStorage 存储键 */
// export const THEME_STORAGE_KEY = "mistake-diagnosis-theme";

// /** 主题选项列表 */
// export const THEMES: ThemeOption[] = [
//   { key: "dark", label: "暗色科技", color: "#6366f1" },
//   { key: "green", label: "浅绿色", color: "#22c55e" },
//   { key: "blue", label: "浅蓝色", color: "#3b82f6" },
// ];

// /** 默认主题 */
// export const DEFAULT_THEME: ThemeKey = "dark";

// /** 校验是否为合法主题 */
// export function isThemeKey(v: unknown): v is ThemeKey {
//   return v === "dark" || v === "green" || v === "blue";
// }

// /** 读取本地存储的主题（SSR 安全，未选择返回默认） */
// export function getStoredTheme(): ThemeKey {
//   if (typeof window === "undefined") return DEFAULT_THEME;
//   try {
//     const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
//     if (raw && isThemeKey(raw)) return raw;
//   } catch {
//     // 忽略存储异常
//   }
//   return DEFAULT_THEME;
// }

// /** 应用主题：写入 localStorage 并切换根元素 data-theme，全局立即生效 */
// export function applyTheme(key: ThemeKey): void {
//   try {
//     window.localStorage.setItem(THEME_STORAGE_KEY, key);
//   } catch {
//     // 忽略存储异常
//   }
//   if (typeof document !== "undefined") {
//     document.documentElement.setAttribute("data-theme", key);
//   }
// }

// /** 初始化主题（客户端入口调用，处理默认值与首次挂载） */
// export function initTheme(): ThemeKey {
//   const key = getStoredTheme();
//   applyTheme(key);
//   return key;
// }
