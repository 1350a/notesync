'use client';
/**
 * 整卷诊断结果面板：步骤进度 + 每组共享诊断卡片（复用单题 DiagnosisCard，无掌握度回路）+ 汇总正文。
 * 移动端：纵向堆叠、卡片全宽（doc/mobile-ux.md §1 桌面不动、窄屏铺满）。
 */
import DiagnosisCard from '@/components/chat/DiagnosisCard';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { PaperViewState } from '@/lib/diagnose/types';

const GROUP_LABEL: Record<string, string> = {
  general: '综合组',
};

export default function PaperResultPanel({ view }: { view: PaperViewState }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="mb-2 font-semibold text-foreground">
          处理进度
          {view.interrupted && (
            <span className="ml-2 rounded-full border border-destructive/40 px-2 py-0.5 text-xs font-normal text-destructive">
              已中断
            </span>
          )}
        </h3>
        <ol className="space-y-1 text-sm text-muted-foreground">
          {view.steps.map((stepItem, i) => (
            <li key={i} className={stepItem.status === 'failed' ? 'text-destructive' : undefined}>
              <span className="mr-1 text-muted-foreground/70">{i + 1}.</span>
              {stepItem.text}
              {stepItem.progress && (
                <span className="ml-1 text-xs text-muted-foreground/70">（{stepItem.progress}）</span>
              )}
            </li>
          ))}
        </ol>
      </div>

      {view.results.map((group, i) => (
        <div key={i} className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-medium text-foreground">
            {GROUP_LABEL[group.groupCode] ?? `组别：${group.groupCode}`} · 题号{' '}
            {group.questionNumbers.join('、')}
          </p>
          <DiagnosisCard result={group.result} />
        </div>
      ))}

      {view.summary && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-2 font-semibold text-foreground">整卷汇总</h3>
          <div className="markdown-body text-sm text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {view.summary}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
