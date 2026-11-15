/**
 * 整卷诊断报告的本机暂存（doc/diagnose-paper.md §8）。
 *
 * 报告此前只活在 useState 里，刷新或跳走即丢；这里把最终 PaperViewState 快照落
 * localStorage 供再次进入页面时恢复。与聊天历史不同库：报告无附件二进制，
 * localStorage 足够，也避免为低价值数据开 IndexedDB 表。仅本机可见：不上行、不跨设备。
 *
 * 键带版本号：视图形状将来变化时换 v2，旧键直接当不存在处理（不尝试迁移）。
 */
import type { PaperViewState } from './types.ts';

const PAPER_REPORT_KEY = 'notesync:paper-report:v1';

/** 快照外层：savedAt 仅留痕（这份报告何时跑的），恢复 UI 暂不展示 */
interface PaperReportSnapshot {
  savedAt: number;
  view: PaperViewState;
}

/** 形状校验：localStorage 是脏数据高发区（手改/旧版本残留），不合规就当不存在 */
function isPaperViewState(value: unknown): value is PaperViewState {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Record<string, unknown>;
  return (
    Array.isArray(view.steps) && Array.isArray(view.results) && typeof view.summary === 'string'
  );
}

/** 暂存最终快照；空报告（一步都没走到）不写，避免恢复出空壳面板 */
export function savePaperReport(view: PaperViewState): void {
  if (typeof window === 'undefined') return;
  if (view.steps.length === 0) return;
  try {
    const snapshot: PaperReportSnapshot = { savedAt: Date.now(), view };
    window.localStorage.setItem(PAPER_REPORT_KEY, JSON.stringify(snapshot));
  } catch {
    // quota 超 / 隐私模式：暂存失败不影响诊断主流程，静默跳过
  }
}

/** 读取上次快照；解析失败或形状不符则清掉脏键当不存在 */
export function loadPaperReport(): PaperViewState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PAPER_REPORT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !isPaperViewState((parsed as PaperReportSnapshot).view)
    ) {
      throw new Error('bad snapshot');
    }
    return (parsed as PaperReportSnapshot).view;
  } catch {
    clearPaperReport();
    return null;
  }
}

export function clearPaperReport(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PAPER_REPORT_KEY);
  } catch {
    // localStorage 不可用时清除同样无效，忽略
  }
}
