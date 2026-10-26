"use client";

import { useEffect, useState } from "react";
import {
  THEMES,
  getStoredTheme,
  applyTheme,
  initTheme,
  type ThemeKey,
} from "@/lib/theme";

interface ThemeSwitcherProps {
  /** 折叠态：只显示当前主题色块 */
  collapsed?: boolean;
}

/**
 * 主题切换器：三个色块按钮（暗色/浅绿/浅蓝），点击即全局切换并持久化。
 */
export default function ThemeSwitcher({ collapsed = false }: ThemeSwitcherProps) {
  const [theme, setTheme] = useState<ThemeKey>("dark");

  // 挂载时读取持久化主题并应用（防闪烁脚本已先行设置 data-theme）
  useEffect(() => {
    const stored = initTheme();
    setTheme(stored);
  }, []);

  const select = (key: ThemeKey) => {
    setTheme(key);
    applyTheme(key);
  };

  if (collapsed) {
    const current = THEMES.find((t) => t.key === theme) ?? THEMES[0];
    return (
      <button
        onClick={() => {
          const idx = THEMES.findIndex((t) => t.key === theme);
          select(THEMES[(idx + 1) % THEMES.length].key);
        }}
        title="切换主题"
        className="mx-auto block h-5 w-5 rounded-full border border-[var(--border)] shadow-inner transition hover:scale-110"
        style={{ backgroundColor: current.color }}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-muted)]">主题</span>
      <div className="flex items-center gap-1.5">
        {THEMES.map((t) => (
          <button
            key={t.key}
            onClick={() => select(t.key)}
            title={t.label}
            aria-label={t.label}
            className={`h-5 w-5 rounded-full border transition ${
              theme === t.key
                ? "scale-110 border-[var(--text)] ring-2 ring-[var(--accent-soft)]"
                : "border-[var(--border)] opacity-70 hover:scale-105 hover:opacity-100"
            }`}
            style={{ backgroundColor: t.color }}
          />
        ))}
      </div>
    </div>
  );
}
