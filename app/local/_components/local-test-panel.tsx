'use client';

/*
 * 本地推理自检面板（app/ocr 自检页模式推广，doc/browser-local-inference.md §8 能力页）。
 *
 * 三段自检：
 * 1. 资产：checkLocalAssets 全量 HEAD；
 * 2. 嵌入：initLocalEngine（携带 WebGPU/WASM 与下载进度）→ 嵌入样例文本，
 *    校验维度与 L2 归一化；
 * 3. 检索：searchKnowledge 走完整链路（IndexedDB 索引构建 + 混合评分），
 *    应用指南类卡片应命中。
 * 验收口径同 OCR 能力页：浏览器实际操作下三项全 PASS。
 */
import { useCallback, useState } from 'react';

import { useLocalEngine } from '@/hooks/useLocalEngine';
import { embedTexts, EMBED_DIM } from '@/lib/local/embedding';
import { searchKnowledge } from '@/lib/local/rag/store';

interface SectionState {
  phase: 'idle' | 'running' | 'pass' | 'fail';
  detail?: string;
}

const IDLE: SectionState = { phase: 'idle' };

function VerdictBadge({ phase }: { phase: SectionState['phase'] }) {
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

function Section({
  title,
  state,
  children,
}: {
  title: string;
  state: SectionState;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <VerdictBadge phase={state.phase} />
      </div>
      {state.detail && (
        <p className="mt-2 break-all text-xs text-muted-foreground">{state.detail}</p>
      )}
      {children}
    </div>
  );
}

export default function LocalTestPanel() {
  const { status, assets, init } = useLocalEngine();
  const [assetState, setAssetState] = useState<SectionState>(IDLE);
  const [embedState, setEmbedState] = useState<SectionState>(IDLE);
  const [searchState, setSearchState] = useState<SectionState>(IDLE);
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    setAssetState({ phase: 'running' });
    setEmbedState(IDLE);
    setSearchState(IDLE);
    try {
      // 1) 资产探测（fresh，不复用挂载期缓存）
      const fresh = await import('@/lib/local/assets').then((m) => m.checkLocalAssets());
      if (!fresh.ready) {
        setAssetState({
          phase: 'fail',
          detail: `缺失 ${fresh.missing.length} 项：${fresh.missing.join('、')}`,
        });
        return;
      }
      setAssetState({ phase: 'pass', detail: `11 项资产全部就位（含 ORT wasm）` });

      // 2) 引擎初始化 + 嵌入校验
      setEmbedState({ phase: 'running', detail: '首次运行需下载 24~30MB 模型权重' });
      const final = await init();
      if (final.state !== 'ready') {
        const message = final.state === 'error' ? final.message : final.state;
        setEmbedState({ phase: 'fail', detail: `引擎初始化失败：${message}` });
        return;
      }
      const deviceLabel = final.device === 'webgpu' ? 'WebGPU（q4f16）' : 'WASM（q8）';
      let embedDetail = `后端 ${deviceLabel}`;
      try {
        const vectors = await embedTexts(['本地嵌入自检文本']);
        const vector = vectors[0];
        if (!vector) throw new Error('嵌入结果为空');
        if (vector.length !== EMBED_DIM) {
          throw new Error(`维度不符：实际 ${vector.length}，期望 ${EMBED_DIM}`);
        }
        let norm = 0;
        for (const v of vector) norm += v * v;
        norm = Math.sqrt(norm);
        // 归一化容差：q4f16 量化扰动下 norm 与 1 的偏差远小于 1e-2
        if (Math.abs(norm - 1) > 1e-2) {
          throw new Error(`未归一化：向量模长 ${norm.toFixed(4)}`);
        }
        embedDetail += `，维度 ${vector.length}，模长 ${norm.toFixed(4)}`;
        setEmbedState({ phase: 'pass', detail: embedDetail });
      } catch (err) {
        setEmbedState({
          phase: 'fail',
          detail: `${embedDetail}；${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      // 3) 检索链路（含 IndexedDB 索引构建）
      setSearchState({ phase: 'running', detail: '首次运行构建种子索引（28+3 卡）' });
      const hits = await searchKnowledge('这个应用是干什么的，怎么用图片识别？');
      const topHit = hits[0];
      if (!topHit) {
        setSearchState({ phase: 'fail', detail: '应用指南类问询未命中任何卡片' });
        return;
      }
      const okSubject = topHit.chunk.subject === '应用指南';
      setSearchState({
        phase: okSubject ? 'pass' : 'fail',
        detail: `Top1：${topHit.chunk.title}（综合分 ${topHit.score.toFixed(3)}，向量分 ${topHit.vectorScore.toFixed(3)}）`,
      });
    } catch (err) {
      // 任一未捕获异常归入检索段展示（前两段已各自收口）
      setSearchState({
        phase: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  }, [init]);

  const engineLabel =
    status.state === 'ready'
      ? `就绪（${status.device === 'webgpu' ? 'WebGPU' : 'WASM'}）`
      : status.state === 'loading'
        ? `加载中 ${Math.round(status.progress * 100)}%`
        : status.state === 'error'
          ? `错误：${status.message}`
          : '未加载';

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={runAll}
        disabled={running}
        className="mx-auto block rounded-xl bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {running ? '检测中…' : '运行自检'}
      </button>

      <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
        <p>引擎：{engineLabel}</p>
        <p>
          存储：
          {typeof navigator !== 'undefined' && navigator.storage?.estimate
            ? '可查询（见自检日志）'
            : '不可用'}
        </p>
      </div>

      <Section title="① 模型资产（public/models/，11 项）" state={assetState} />
      <Section
        title="② 嵌入引擎（WebGPU/WASM 自动选择）"
        state={embedState}
      />
      <Section title="③ 检索链路（IndexedDB + 混合评分）" state={searchState} />

      <p className="text-center text-xs text-muted-foreground">
        资产缺失时运行 <code className="rounded bg-muted px-1">npm run local:assets</code>
        ；下载需可访问 huggingface.co 或设 HF_MIRROR 镜像。
      </p>
    </div>
  );
}
