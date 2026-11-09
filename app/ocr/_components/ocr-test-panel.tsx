'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  checkOcrAssets,
  disposeOcrWorker,
  normalizeOcrText,
  ocrRecognize,
  type OcrAssetStatus,
  type OcrProgress,
  type OcrResult,
} from '@/lib/ocr/local';

/**
 * 内置自检的期望文本。
 * 刻意只用高频汉字且不含标点/数字：OCR 对标点与窄字符易产生歧义，
 * 验收应衡量"识别能力"本身，而不是被字符噪声干扰（见 doc/browser-local-ocr.md §5）。
 */
const EXPECTED_LINES = ['本地光学字符识别测试', '数据不出设备隐私优先'];

const STATUS_LABELS: Record<string, string> = {
  'loading tesseract core': '加载推理核心',
  'initializing tesseract': '初始化引擎',
  'loading language traineddata': '加载语言包',
  'initializing api': '初始化识别接口',
  'recognizing text': '识别中',
};

interface SelfTestState {
  phase: 'idle' | 'running' | 'done';
  result?: OcrResult;
  pass?: boolean;
  error?: string;
  imagePreviewUrl?: string;
}

interface CustomState {
  phase: 'idle' | 'running' | 'done';
  file?: File;
  previewUrl?: string;
  result?: OcrResult;
  error?: string;
}

/** 用 canvas 渲染期望文本生成测试 PNG（Promise 化，失败显式抛错） */
function renderSelfTestImage(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 340;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('当前环境不支持 canvas 2d，无法生成自检图'));
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111111';
    ctx.font = '64px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(EXPECTED_LINES[0], 60, 110);
    ctx.fillText(EXPECTED_LINES[1], 60, 240);
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('自检图生成失败（canvas.toBlob 返回空）'));
    }, 'image/png');
  });
}

function ProgressLine({ progress }: { progress: OcrProgress | null }) {
  if (!progress) return null;
  const label = STATUS_LABELS[progress.status] ?? progress.status;
  const percent =
    progress.progress >= 0 ? ` ${Math.round(progress.progress * 100)}%` : '';
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {label}
      {percent}
    </p>
  );
}

function ResultBlock({ result }: { result: OcrResult }) {
  return (
    <div className="mt-3 space-y-2">
      <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
        {result.text || '（未识别到文本）'}
      </pre>
      <p className="text-xs text-muted-foreground">
        置信度 {result.confidence.toFixed(1)}% · 耗时 {result.elapsedMs} ms
      </p>
    </div>
  );
}

export default function OcrTestPanel() {
  const [assets, setAssets] = useState<OcrAssetStatus | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestState>({ phase: 'idle' });
  const [custom, setCustom] = useState<CustomState>({ phase: 'idle' });
  const previewUrlRef = useRef<string | null>(null);

  // 资产未就绪属于"可修复的不可用态"：如实展示缺失清单与修复命令，禁用识别入口
  useEffect(() => {
    let cancelled = false;
    checkOcrAssets().then((status) => {
      if (!cancelled) setAssets(status);
    });
    return () => {
      cancelled = true;
      // 离开页面即释放引擎内存；语言包由浏览器 HTTP 缓存兜底，重进页面无需重新下载
      void disposeOcrWorker();
    };
  }, []);

  const assetsReady = assets?.ready ?? false;
  const busy = selfTest.phase === 'running' || custom.phase === 'running';

  const runSelfTest = useCallback(async () => {
    setSelfTest({ phase: 'running' });
    setProgress(null);
    try {
      const blob = await renderSelfTestImage();
      const previewUrl = URL.createObjectURL(blob);
      const result = await ocrRecognize(blob, setProgress);
      // 逐行做包含式规范化比对：容忍换行/空格/全半角差异
      const normalized = normalizeOcrText(result.text);
      const pass = EXPECTED_LINES.every((line) =>
        normalized.includes(normalizeOcrText(line)),
      );
      setSelfTest({ phase: 'done', result, pass, imagePreviewUrl: previewUrl });
    } catch (err) {
      setSelfTest({
        phase: 'done',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setProgress(null);
    }
  }, []);

  const runCustomRecognize = useCallback(async () => {
    if (!custom.file) return;
    setCustom((s) => ({ ...s, phase: 'running' }));
    setProgress(null);
    try {
      const result = await ocrRecognize(custom.file, setProgress);
      setCustom((s) => ({ ...s, phase: 'done', result }));
    } catch (err) {
      setCustom((s) => ({
        ...s,
        phase: 'done',
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setProgress(null);
    }
  }, [custom.file]);

  const onFileChange = useCallback(
    (file: File | null) => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      if (!file) {
        setCustom({ phase: 'idle' });
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      previewUrlRef.current = previewUrl;
      setCustom({ phase: 'idle', file, previewUrl });
    },
    [],
  );

  if (assets && !assets.ready) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        <p className="font-medium text-destructive">本地 OCR 资源未就绪，能力不可用</p>
        <p className="mt-2 text-muted-foreground">
          缺少以下运行时资产（识别引擎与语言包必须自托管，不会回退到 CDN）：
        </p>
        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
          {assets.missing.map((url) => (
            <li key={url}>{url}</li>
          ))}
        </ul>
        <p className="mt-2">
          请在项目根目录执行 <code className="rounded bg-muted px-1.5 py-0.5">npm run ocr:assets</code>
          {' '}后刷新页面。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProgressLine progress={progress} />

      {/* 内置自检 */}
      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-semibold">内置自检</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          用 canvas 生成含已知文本的图片并识别，与期望文本规范化比对
          （期望：{EXPECTED_LINES.join(' / ')}）。
        </p>
        <button
          type="button"
          onClick={runSelfTest}
          disabled={!assetsReady || busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {selfTest.phase === 'running' ? '识别中…' : '运行自检'}
        </button>
        {selfTest.phase === 'done' && selfTest.error && (
          <p className="mt-3 text-sm text-destructive">自检失败：{selfTest.error}</p>
        )}
        {selfTest.phase === 'done' && selfTest.result && (
          <div className="mt-3">
            <p
              className={`text-sm font-medium ${
                selfTest.pass ? 'text-green-600' : 'text-destructive'
              }`}
            >
              {selfTest.pass ? 'PASS：识别结果与期望一致' : 'FAIL：识别结果与期望不一致'}
            </p>
            {selfTest.imagePreviewUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- 本地 blob 预览，无需优化域名 */
              <img
                src={selfTest.imagePreviewUrl}
                alt="自检测试图"
                className="mt-3 max-w-full rounded-md border"
              />
            )}
            <ResultBlock result={selfTest.result} />
          </div>
        )}
      </section>

      {/* 自定义图片 */}
      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-semibold">自定义图片识别</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          选择本机图片进行本地识别，图片不会离开浏览器。
        </p>
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        {custom.previewUrl && (
          /* eslint-disable-next-line @next/next/no-img-element -- 本地 blob 预览，无需优化域名 */
          <img
            src={custom.previewUrl}
            alt="待识别图片预览"
            className="mt-3 max-h-64 max-w-full rounded-md border object-contain"
          />
        )}
        <button
          type="button"
          onClick={runCustomRecognize}
          disabled={!assetsReady || busy || !custom.file}
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {custom.phase === 'running' ? '识别中…' : '开始识别'}
        </button>
        {custom.phase === 'done' && custom.error && (
          <p className="mt-3 text-sm text-destructive">识别失败：{custom.error}</p>
        )}
        {custom.phase === 'done' && custom.result && (
          <ResultBlock result={custom.result} />
        )}
      </section>
    </div>
  );
}
