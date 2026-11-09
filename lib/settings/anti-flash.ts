/**
 * 用户设置 - 首帧主题防闪烁内联脚本（静态常量，构建期确定，不含任何用户数据）。
 *
 * 必须在水合前同步执行：读取 localStorage 设置并按主题预设 dark 类，
 * 避免暗色用户首帧白屏闪烁；AppLayout 水合后接管后续切换。
 * 独立成模块：app/layout.tsx 仅引用常量，注入内容可集中审计。
 * 解析规则与 lib/settings/types.ts 的 normalize 保持一致（非 light/dark 一律按 system 处理）。
 */
export const ANTI_FLASH_SCRIPT = `(function(){try{var raw=localStorage.getItem('notesync-settings.v1');var theme='system';if(raw){var parsed=JSON.parse(raw);if(parsed&&(parsed.theme==='dark'||parsed.theme==='light'))theme=parsed.theme;}var dark=theme==='dark'||(theme==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark');}catch(e){}})();`;
