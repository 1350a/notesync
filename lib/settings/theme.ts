/**
 * 用户设置 - 主题判定（浏览器专用助手，纯函数部分可安全在 SSR 调用）。
 */
import type { ThemePreference } from './types.ts';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 解析主题偏好的实际暗色效果；'system' 跟随系统（SSR/无 matchMedia 环境回 false） */
export function isDarkEffective(theme: ThemePreference): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches;
}

/**
 * 订阅系统主题变化（仅 'system' 偏好需要实时联动）；返回取消订阅函数。
 * 老浏览器无 matchMedia/addEventListener 时静默退化为不联动。
 */
export function watchSystemTheme(onChange: (dark: boolean) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DARK_QUERY);
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  mql.addEventListener('change', listener);
  return () => mql.removeEventListener('change', listener);
}
