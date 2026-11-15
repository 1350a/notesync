'use client';

import type { ReactNode } from 'react';

/** "未实装"标注：凡无能力支撑的占位控件必须挂上（AGENTS.md §8 诚实接线） */
export function NotWiredBadge() {
  return (
    <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] leading-4 text-amber-700">
      未实装
    </span>
  );
}

/** 设置行：左侧标签（可带说明与标注），右侧控件；行间细分隔线与参考稿一致。
 *  窄屏纵向堆叠（标签在上、控件在下并允许换行），≥md 恢复左右两端对齐。 */
export default function SettingsRow({
  label,
  hint,
  badge,
  children,
}: {
  label: string;
  hint?: string;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border/60 py-4 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {badge}
        </div>
        {hint && (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:shrink-0">{children}</div>
      )}
    </div>
  );
}

/** 禁用占位下拉的统一样式（语言/朗读音色等未实装行用） */
export const DISABLED_SELECT_CLASS =
  'rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground outline-none cursor-not-allowed opacity-60';
