/*
 * 自检面板共用件（app/(main)/local 与 app/(main)/ocr 两处自检页原先各写一套）。
 *
 * 只承载"分区框 + 结论徽标"这两件纯展示物，不含任何探测/识别逻辑：
 * 各页的判定口径、失败原因文案仍由调用方负责，避免把不同能力域的验收语义
 * 耦合进通用组件（doc/browser-local-inference.md §7、doc/browser-local-ocr.md §5）。
 */
import type { ReactNode } from 'react';

export type SelfTestPhase = 'idle' | 'running' | 'pass' | 'fail';

export interface SelfTestState {
  phase: SelfTestPhase;
  detail?: string;
}

/** 初始态常量：调用方 `useState(SELF_TEST_IDLE)` 即可，避免各页各写一份字面量 */
export const SELF_TEST_IDLE: SelfTestState = { phase: 'idle' };

/** 结论徽标：待检测 / 检测中 / PASS / FAIL */
export function VerdictBadge({ phase }: { phase: SelfTestPhase }) {
  if (phase === 'idle') return <span className="text-xs text-muted-foreground">待检测</span>;
  if (phase === 'running') return <span className="text-xs text-blue-600">检测中…</span>;
  if (phase === 'pass') {
    return (
      <span className="rounded-md bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        PASS
      </span>
    );
  }
  return (
    <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      FAIL
    </span>
  );
}

/**
 * 自检分区：标题行右侧固定一枚徽标，`state.detail` 作为一行摘要展示。
 * `state` 省略时只渲染纯分区框（供无结论语义的普通区块复用）。
 */
export function SelfTestSection({
  title,
  description,
  state,
  children,
}: {
  title: string;
  description?: string;
  state?: SelfTestState;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        {state && <VerdictBadge phase={state.phase} />}
      </div>
      {description && (
        <p className="mt-1 mb-3 text-sm text-muted-foreground">{description}</p>
      )}
      {state?.detail && (
        <p className="mt-2 break-all text-xs text-muted-foreground">{state.detail}</p>
      )}
      {children}
    </div>
  );
}
