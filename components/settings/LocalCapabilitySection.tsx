'use client';

/*
 * 设置 - 本地能力分区（doc/browser-local-inference.md §7）
 *
 * 四行结构：图片处理（OCR）/ 知识检索（RAG）/ 本地引擎 / 本地对话。
 * - 图片处理行＝转写引擎选择（本地/云端，默认云端；2026-11-14 起取代旧
 *   「自动/优先本地OCR」+「识别引擎」两行），全站唯一入口；
 * - 知识检索与本地引擎两行取 dev 侧实现（资产就绪门禁 + 引擎状态机），
 *   预加载入口收敛到「本地引擎」行唯一一处；
 * - 本地对话为 v2 占位（诚实接线，AGENTS.md §8）。
 */

import { useCallback, useState } from 'react';

import SettingsRow, { DISABLED_SELECT_CLASS, NotWiredBadge } from './SettingsRow';
import { useLocalEngine } from '@/hooks/useLocalEngine';
import { useModels } from '@/hooks/useModels';
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
  'w-24 rounded-xl border px-2 py-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 max-md:min-w-0 max-md:flex-1';

/**
 * 「本地能力」分区（doc/browser-local-inference.md §7）。
 * 诚实接线（AGENTS.md §8）：资产未就绪时开关一律置灰并给出修复命令，
 * 不渲染任何假可用控件；引擎状态与下载进度经 useLocalEngine 与 app/(main)/local
 * 能力页同源（引擎单例 800ms 轮询，分区条件挂载即停表）。
 */
export default function LocalCapabilitySection() {
  const ocr = useSettingsStore((s) => s.settings.ocr);
  const ragEnabled = useSettingsStore((s) => s.settings.rag.enabled);
  const updateSettings = useSettingsStore((s) => s.update);

  // 云端引擎可用性来自 GET /api/models 的 providers 明细（doc/cloud-ocr.md §4 可用性门禁）：
  // 探测未完成按不可用处理（宁可禁用，不做乐观假设），zhipu unconfigured 时云端选项置灰
  const { providers, loading: modelsLoading } = useModels();
  const cloudOcrReady =
    !modelsLoading && Boolean(providers?.some((p) => p.name === 'zhipu' && p.status !== 'unconfigured'));

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
          <ul className="mt-2 list-disc break-all pl-5 text-muted-foreground">
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

      {/* 图片处理（OCR）＝转写引擎选择（2026-11-14 重构，doc/cloud-ocr.md §4）：
          一行两档，默认云端。转写只发生在纯文本模型路径——多模态模型直传原图、
          无转写（product-vision.md P4 自动路由）；旧 preferLocal（自动/优先本地OCR）
          与输入区当次三档切换已删。cloud 档图片像素上行至智谱 glm-ocr；
          zhipu 未配置时云端置灰（诚实接线，不静默回落本地） */}
      <SettingsRow
        label="图片处理（OCR）"
        hint={
          ocr.engine === 'cloud'
            ? '默认云端 glm-ocr：公式/表格/手写识别更好，转写时图片像素将发送至智谱；仅纯文本模型路径生效（多模态模型直传原图）'
            : '本地 tesseract：全程浏览器内转写（隐私）；手写/公式/复杂版面较弱'
        }
      >
        <div className="flex w-full gap-2">
          <button
            type="button"
            onClick={() => updateSettings({ ocr: { engine: 'local' } })}
            className={`${TOGGLE_CLASS} ${
              ocr.engine === 'local'
                ? 'border-foreground/50 bg-muted font-medium'
                : 'border-border hover:bg-muted/50'
            }`}
          >
            本地
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ ocr: { engine: 'cloud' } })}
            disabled={!cloudOcrReady}
            title={cloudOcrReady ? undefined : '需在 .env 配置 ZHIPU_API_KEY 后可用'}
            className={`${TOGGLE_CLASS} ${
              ocr.engine === 'cloud'
                ? 'border-foreground/50 bg-muted font-medium'
                : 'border-border hover:bg-muted/50'
            }`}
          >
            云端·glm-ocr
          </button>
        </div>
      </SettingsRow>

      <SettingsRow
        label="知识检索（RAG）"
        hint="开启后发送前在浏览器内检索内置知识卡，命中片段随消息提交；引擎未就绪时静默跳过"
      >
        <div className="flex w-full gap-2">
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            role="status"
            className={`min-w-0 break-words text-xs ${
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
