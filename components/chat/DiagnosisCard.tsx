'use client';
/**
 * 诊断结果卡片（DiagnosisResult 渲染 + explain 掌握度回路入口）
 *
 * 契约：wip-diagnosis-model.md §6（结构）、wip-agent-workflow.md §4.3（掌握度回路：
 * 明白了→结束；还不懂/继续→阶梯降一级；不强制不阻塞——不点也能正常继续对话）。
 * 移动端遵循 doc/mobile-ux.md §4：触屏按钮热区 ≥44px（touch: variant）。
 */
import type { DiagnoseRequestEvent, DiagnosisResult } from '@/lib/diagnose/types';

/** 错因 code → 中文标签（与 lib/diagnose/error-causes.ts 同源；客户端引常量即可，无需复制） */
import { findErrorCause } from '@/lib/diagnose/error-causes';

const HINT_LEVEL_LABEL: Record<1 | 2 | 3, string> = {
  1: '定位',
  2: '方向',
  3: '关键步骤',
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded-md px-2 py-0.5 text-[11px]"
      style={{ border: '1px solid var(--border)', backgroundColor: 'var(--panel-soft)', color: 'var(--text-secondary)' }}
    >
      {children}
    </span>
  );
}

function CauseLine({ code, confidence, role }: { code: string; confidence: number; role: string }) {
  const cause = findErrorCause(code);
  const percent = Math.round(confidence * 100);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
        {role}：{cause ? cause.label : code}
      </span>
      <span
        className="inline-flex items-center gap-1"
        title={`模型自评置信度 ${percent}%（A 级假设，仅供参考）`}
      >
        <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--border)' }}>
          <span className="block h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: 'var(--accent)' }} />
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {percent}%
        </span>
      </span>
    </div>
  );
}

export default function DiagnosisCard({
  result,
  onAction,
}: {
  result: DiagnosisResult;
  /** 掌握度回路回调；未提供（如整卷场景）则不渲染按钮 */
  onAction?: (event: DiagnoseRequestEvent, label: string) => void;
}) {
  const isL2 = result.level === 'L2';
  return (
    <div
      className="mt-2 rounded-xl p-3"
      style={{ border: '1px solid var(--border)', backgroundColor: 'var(--panel-soft)' }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Chip>{isL2 ? 'L2 错因归因' : 'L1 题目画像'}</Chip>
        {result.completeness.hasStudentAnswer ? null : <Chip>未提供作答</Chip>}
        {result.completeness.hasCorrectAnswer ? null : <Chip>未提供正确答案</Chip>}
      </div>

      {result.knowledgePoints.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            考点
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.knowledgePoints.map((point, i) => (
              <Chip key={i}>{point}</Chip>
            ))}
          </div>
        </div>
      )}

      {result.errorCause && (
        <div className="mb-1">
          <CauseLine code={result.errorCause.code} confidence={result.errorCause.confidence} role="主错因" />
        </div>
      )}
      {result.secondaryErrorCause && (
        <div className="mb-1">
          <CauseLine
            code={result.secondaryErrorCause.code}
            confidence={result.secondaryErrorCause.confidence}
            role="次错因"
          />
        </div>
      )}

      {result.strategy && result.strategy.steps.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            策略卡（{result.strategy.subject === 'math' ? '数学' : result.strategy.subject} · v{result.strategy.version}）
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm" style={{ color: 'var(--text)' }}>
            {result.strategy.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {result.hints.length > 0 && (
        <div className="mt-2 space-y-1">
          {result.hints.map((hint, i) => (
            <p key={i} className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="mr-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                [提示·{HINT_LEVEL_LABEL[hint.level] ?? hint.level}]
              </span>
              {hint.content}
            </p>
          ))}
        </div>
      )}

      {result.notes && (
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {result.notes}
        </p>
      )}

      {onAction && isL2 && (
        // 掌握度回路（wip-agent-workflow.md §4.3(a)）：触屏 44px 热区，窄屏三等分铺满
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onAction({ type: 'hint_descend' }, '继续')}
            className="rounded-lg px-2 py-2 text-sm touch:h-11 touch:text-base"
            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            继续
          </button>
          <button
            type="button"
            onClick={() => onAction({ type: 'hint_descend' }, '还不懂')}
            className="rounded-lg px-2 py-2 text-sm touch:h-11 touch:text-base"
            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            还不懂
          </button>
          <button
            type="button"
            onClick={() => onAction({ type: 'mastered' }, '明白了')}
            className="rounded-lg px-2 py-2 text-sm touch:h-11 touch:text-base"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            明白了
          </button>
        </div>
      )}
    </div>
  );
}
