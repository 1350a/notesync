'use client';

/*
 * 设置 - 本地能力分区（doc/browser-local-inference.md §7）
 *
 * 按任务三行（路由绝对权在使用者）：OCR / 知识检索 / 本地对话。
 * 图片处理行自通用设置迁入；本地对话为 v2 占位（诚实接线，AGENTS.md §8）。
 */
import { useState } from 'react';

import { useLocalEngine } from '@/hooks/useLocalEngine';
import SettingsRow, { DISABLED_SELECT_CLASS, NotWiredBadge } from './SettingsRow';
import { useSettingsStore } from '@/store/useSettingsStore';

/** 引擎/资产状态的中文摘要，作为检索行的动态 hint 展示 */
function useRagStatusHint(): string {
  const { status, assets } = useLocalEngine();
  if (assets === null) return '正在检查本地资产…';
  if (!assets.ready) {
    return `模型资产缺失（共缺 ${assets.missing.length} 项），请运行 npm run local:assets 后刷新`;
  }
  switch (status.state) {
    case 'ready':
      return `已就绪（${status.device === 'webgpu' ? 'WebGPU 加速' : 'WASM'}）`;
    case 'loading':
      return `模型加载中 ${Math.round(status.progress * 100)}%`;
    case 'error':
      return `不可用：${status.message}`;
    case 'idle':
      return '模型未加载；发送消息时自动加载，或点击右侧"预载模型"';
  }
}

export default function LocalCapabilitySection() {
  const preferLocalOcr = useSettingsStore((s) => s.settings.ocr.preferLocal);
  const ragEnabled = useSettingsStore((s) => s.settings.rag.enabled);
  const updateSettings = useSettingsStore((s) => s.update);
  const { status, init } = useLocalEngine();
  const [preloading, setPreloading] = useState(false);

  const ragStatusHint = useRagStatusHint();

  const handlePreload = async () => {
    setPreloading(true);
    try {
      await init();
    } finally {
      setPreloading(false);
    }
  };

  return (
    <div>
      {/* 图片处理（自通用设置迁入，语义 doc/browser-local-ocr.md §6.1不变）：
          输入区贴图后仍可当次切换，此处为持久默认 */}
      <SettingsRow
        label="图片处理（OCR）"
        hint="优先本地OCR：图片先在浏览器内转文字再发送（隐私、省token，纯文本模型可用）；自动：多模态模型直传原图、纯文本模型转文字"
      >
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => updateSettings({ ocr: { preferLocal: false } })}
            className={`w-24 rounded-xl border px-2 py-3 text-xs transition-colors ${
              !preferLocalOcr
                ? 'border-foreground/50 bg-muted font-medium'
                : 'border-border hover:bg-muted/50'
            }`}
          >
            自动
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ ocr: { preferLocal: true } })}
            className={`w-24 rounded-xl border px-2 py-3 text-xs transition-colors ${
              preferLocalOcr
                ? 'border-foreground/50 bg-muted font-medium'
                : 'border-border hover:bg-muted/50'
            }`}
          >
            优先本地OCR
          </button>
        </div>
      </SettingsRow>

      {/* 知识检索（rag.enabled，语义 doc/browser-local-inference.md §6）：
          开关 + 引擎状态透出（wiring honesty），资产缺失时给出修复命令 */}
      <SettingsRow
        label="知识检索（RAG）"
        hint={`开启后发送消息前先在浏览器内置知识库中检索并附给 AI 参考，语料与查询不经过服务器。当前状态：${ragStatusHint}`}
      >
        <div className="flex items-center gap-2">
          {status.state === 'idle' && (
            <button
              type="button"
              onClick={handlePreload}
              disabled={preloading}
              className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-60"
            >
              {preloading ? '加载中…' : '预载模型'}
            </button>
          )}
          <button
            type="button"
            onClick={() => updateSettings({ rag: { enabled: !ragEnabled } })}
            className={`w-24 rounded-xl border px-2 py-3 text-xs transition-colors ${
              ragEnabled
                ? 'border-foreground/50 bg-muted font-medium'
                : 'border-border hover:bg-muted/50'
            }`}
          >
            {ragEnabled ? '已开启' : '已关闭'}
          </button>
        </div>
      </SettingsRow>

      {/* 未实装占位：v2 小 LLM（诚实接线，AGENTS.md §8） */}
      <SettingsRow
        label="本地对话"
        badge={<NotWiredBadge />}
        hint="浏览器内小模型对话（v2 计划）；当前对话仅走云端模型"
      >
        <select disabled className={DISABLED_SELECT_CLASS}>
          <option>仅云端</option>
        </select>
      </SettingsRow>
    </div>
  );
}
