/**
 * 用户设置 - 主题判定与落地（浏览器专用助手，纯函数无副作用）。
 *
 * 四档主题（doc/user-settings.md §4）：light / dark / sky / mint。
 * 落地方式：<html data-theme="<主题>">，深色额外挂 .dark 类，
 * 让 tailwind 的 dark: variant（app/globals.css 顶部 @custom-variant）继续生效。
 */
import type { ThemePreference } from './types.ts';

/** 四档中仅 dark 为深色主题 */
export function isDarkTheme(theme: ThemePreference): boolean {
  return theme === 'dark';
}

/**
 * 把主题写到 <html>：data-theme 决定色板，.dark 决定 dark: variant 与原生控件配色。
 * 全站唯一生效点（AppLayout 调用），各页不再自行处理。
 */
export function applyTheme(theme: ThemePreference, root?: HTMLElement): void {
  const el = root ?? document.documentElement;
  el.dataset.theme = theme;
  el.classList.toggle('dark', isDarkTheme(theme));
}
