'use client';

import { useCallback, useState } from 'react';

import SettingsRow, { DISABLED_SELECT_CLASS, NotWiredBadge } from './SettingsRow';
import { useLocalEngine } from '@/hooks/useLocalEngine';
import type { LocalEngineStatus } from '@/lib/local/engine';
import { useSettingsStore } from '@/store/useSettingsStore';

/** 引擎状态文案（doc/browser-local-inference.md §4 状态机：idle/loading/ready/error） */
function describeEngineStatus(status: LocalEngineStatus): string {
  switch (status.state) {
    case 'idle':
      return '未加载（首次检索时按需加载）';
    case 'loading':
      return `模型加载中 ${Math.round(status.progress * 100)}%`;
    case 'ready':
      return `已就绪 · ${status.device === 'webgpu' ? 'WebGPU' : 'WASM'}`;
    case 'error':
      return `不可用：${status.message}`;
  }
}

const TOGGLE_CLASS =
  'w-24 rounded-xl border px-2 py-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60';

/**
 * 「本地能力」分区（doc/browser-local-inference.md §7）。
 * 诚实接线（AGENTS.md §8）：资产未就绪时开关一律置灰并给出修复命令，
 * 不渲染任何假可用控件；引擎状态与下载进度经 useLocalEngine 与 app/(main)/local
 * 能力页同源（引擎单例 800ms 轮询，分区条件挂载即停表）。
 */
export default function LocalCapabilitySection() {
  const ragEnabled = useSettingsStore((s) => s.settings.rag.enabled);
  const updateSettings = useSettingsStore((s) => s.update);

  const { status: engine, assets, init } = useLocalEngine();
  // starting 提供点击→首帧 loading 间的即时反馈（轮询粒度 800ms，补齐这个空窗）
  const [starting, setStarting] = useState(false);

  // 未探测完成按"未就绪"处理：宁可禁用，也不做乐观假设
  const assetsReady = assets?.ready ?? false;

  const startEngine = useCallback(() => {
    setStarting(true);
    // init 正常不 reject（错误终态由引擎单例状态机承载并经轮询回显）
    void init().finally(() => setStarting(false));
  }, [init]);

  const engineBusy = starting || engine.state === 'loading';

  return (
    <div>
      {assets && !assets.ready && (
        <div className="mt-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p className="font-medium text-destructive">本地运行时资产未就绪，本地能力不可用</p>
          <p className="mt-2 text-muted-foreground">
            缺少以下资产（模型与 ONNX Runtime 全部自托管，不会回退到 CDN）：
          </p>
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">
            {assets.missing.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
          <p className="mt-2">
            请在项目根目录执行{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">npm run local:assets</code>{' '}
            后刷新页面。
          </p>
        </div>
      )}

      <SettingsRow
        label="知识检索（RAG）"
        hint="开启后发送前在浏览器内检索内置知识卡，命中片段随消息提交；引擎未就绪时静默跳过"
      >
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => updateSettings({ rag: { enabled: false } })}
            className={`${TOGGLE_CLASS} ${
              !ragEnabled
                ? 'border-foreground/50 bg-muted font-medium'
                : 'border-border hover:bg-muted/50'
            }`}
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ rag: { enabled: true } })}
            disabled={!assetsReady}
            className={`${TOGGLE_CLASS} ${
              ragEnabled
                ? 'border-foreground/50 bg-muted font-medium'
                : 'border-border hover:bg-muted/50'
            }`}
          >
            开启
          </button>
        </div>
      </SettingsRow>

      <SettingsRow
        label="本地引擎"
        hint={
          assets === null
            ? '正在检测本地资产…'
            : assetsReady
              ? '嵌入模型 bge-small-zh-v1.5（WebGPU 优先，不可用时回退 WASM）'
              : '资产缺失，请先执行 npm run local:assets'
        }
      >
        <div className="flex items-center gap-3">
          <span
            role="status"
            className={`text-xs ${
              engine.state === 'error' ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {describeEngineStatus(engine)}
          </span>
          {(engine.state === 'idle' || engine.state === 'error') && (
            <button
              type="button"
              onClick={startEngine}
              disabled={!assetsReady || engineBusy}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {engine.state === 'error' ? '重试加载' : '预加载引擎'}
            </button>
          )}
        </div>
      </SettingsRow>

      {/* 未实装占位：v1 仅云端推理，本地对话按 doc §7 挂账（AGENTS.md §8 诚实接线） */}
      <SettingsRow
        label="本地对话"
        badge={<NotWiredBadge />}
        hint="v1 仅云端推理，本地小模型尚未接入"
      >
        <select disabled className={DISABLED_SELECT_CLASS}>
          <option>暂不可选</option>
        </select>
      </SettingsRow>
    </div>
  );
}
