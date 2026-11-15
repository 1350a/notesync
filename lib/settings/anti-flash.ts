/**
 * 用户设置 - 首帧主题防闪烁内联脚本（静态常量，构建期确定，不含任何用户数据）。
 *
 * 必须在水合前同步执行：读取 localStorage 设置并把 data-theme 写到 <html>，
 * 避免非默认主题用户首帧错色闪烁；AppLayout 水合后接管后续切换。
 * 独立成模块：app/layout.tsx 仅引用常量，注入内容可集中审计。
 * 解析规则与 lib/settings/types.ts 的 normalize 保持一致（四档之外的旧值/坏值一律按 light）。
 */
export const ANTI_FLASH_SCRIPT = `(function(){try{var raw=localStorage.getItem('notesync-settings.v1');var theme='light';if(raw){var parsed=JSON.parse(raw);var t=parsed&&parsed.theme;if(t==='light'||t==='dark'||t==='sky'||t==='mint')theme=t;}var el=document.documentElement;el.setAttribute('data-theme',theme);if(theme==='dark')el.classList.add('dark');else el.classList.remove('dark');}catch(e){}})();`;
