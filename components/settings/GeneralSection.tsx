'use client';

import { useEffect, useState } from 'react';
import SettingsRow from './SettingsRow';
import { useModels } from '@/hooks/useModels';
import {
  defaultTtsVoice,
  engineHasVoice,
  getTtsEngine,
  TTS_ENGINES,
  type TtsEngineId,
} from '@/lib/tts/catalog';
import { MAX_TOKENS_PRESETS, type ThemePreference } from '@/lib/settings/types';
import { useSettingsStore } from '@/store/useSettingsStore';

const THEME_OPTIONS: { value: ThemePreference; icon: string; label: string }[] = [
  { value: 'light', icon: '☀️', label: '浅色' },
  { value: 'dark', icon: '🌙', label: '深色' },
  { value: 'sky', icon: '🌤️', label: '天空' },
  { value: 'mint', icon: '🍃', label: '薄荷' },
];

/**
 * 思考预算下拉选项（doc/user-settings.md §2.1）：三档预设 + 「跟随模型默认」。
 * 取值直接落 GenerationSettings.maxTokens；空字符串表示不携带该参数。
 */
const MAX_TOKENS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '跟随模型默认' },
  { value: String(MAX_TOKENS_PRESETS.low), label: `低（${MAX_TOKENS_PRESETS.low} tokens）` },
  { value: String(MAX_TOKENS_PRESETS.medium), label: `中（${MAX_TOKENS_PRESETS.medium} tokens）` },
  { value: String(MAX_TOKENS_PRESETS.high), label: `高（${MAX_TOKENS_PRESETS.high} tokens）` },
];

export default function GeneralSection() {
  const theme = useSettingsStore((s) => s.settings.theme);
  const defaultModel = useSettingsStore((s) => s.settings.defaultModel);
  const generation = useSettingsStore((s) => s.settings.generation);
  const tts = useSettingsStore((s) => s.settings.tts);
  const updateSettings = useSettingsStore((s) => s.update);
  // 分区挂载时才拉模型列表（弹窗关闭时本组件不渲染，不产生请求）
  const { models, loading } = useModels();
  // 引擎可用性（key 是否配置）来自 GET /api/tts；探测失败不阻塞下拉——
  // 照常可选，朗读时由 503 unconfigured 明确报错（doc/tts.md §2）
  const [ttsEngines, setTtsEngines] = useState<Record<TtsEngineId, boolean> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tts')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (cancelled || !data || typeof data !== 'object') return;
        const engines = (data as { engines?: unknown }).engines;
        if (!engines || typeof engines !== 'object') return;
        const record = engines as Record<string, unknown>;
        setTtsEngines({
          zhipu: record.zhipu === true,
          deepseek: record.deepseek === true,
        });
      })
      .catch(() => {
        // 探测失败保持 null：下拉照常展示，不猜引擎可用性
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // store.update 是浅合并：必须展开现有 generation，否则思考档位等参数会被整体清掉
  const setMaxTokens = (raw: string) => {
    const next = { ...generation };
    if (raw === '') delete next.maxTokens;
    else next.maxTokens = Number(raw);
    updateSettings({ generation: next });
  };

  // 切引擎时音色随迁：旧引擎音色不属于新引擎目录则回落其默认音色（doc/tts.md §5）
  const setTtsEngine = (engine: TtsEngineId) => {
    updateSettings({
      tts: { engine, voice: engineHasVoice(engine, tts.voice) ? tts.voice : defaultTtsVoice(engine) },
    });
  };

  return (
    <div>
      <SettingsRow label="主题" hint="四套配色，切换后立即生效并记住选择">
        <div className="flex w-full gap-2">
          {THEME_OPTIONS.map((option) => {
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => updateSettings({ theme: option.value })}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs transition-colors ${
                  active
                    ? 'border-foreground/50 bg-muted font-medium'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <span className="text-base">{option.icon}</span>
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsRow>

      <SettingsRow
        label="默认模型"
        hint="新会话优先选中；所选模型失效时回落到列表首项"
      >
        <select
          value={defaultModel}
          onChange={(e) => updateSettings({ defaultModel: e.target.value })}
          disabled={loading && models.length === 0}
          className="max-w-56 cursor-pointer truncate rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60 max-md:w-full max-md:max-w-full"
        >
          <option value="">跟随后端推荐</option>
          {models.map((model) => (
            <option key={model.name} value={model.name}>
              {model.name}
            </option>
          ))}
        </select>
      </SettingsRow>

      {/* 思考预算（doc/user-settings.md §2.1）：三档预设 + 跟随模型默认；
          落到请求体是 max_tokens，custom provider 不下发（未知字段严格校验） */}
      <SettingsRow
        label="思考预算"
        hint="单轮思考/输出上限；custom 服务商不支持该参数，选择后不生效"
      >
        <select
          value={generation.maxTokens === undefined ? '' : String(generation.maxTokens)}
          onChange={(e) => setMaxTokens(e.target.value)}
          className="max-w-56 cursor-pointer truncate rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60 max-md:w-full max-md:max-w-full"
        >
          {MAX_TOKENS_OPTIONS.map((option) => (
            <option key={option.value || 'default'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingsRow>

      {/* 朗读引擎 + 朗读音色（doc/tts.md §5，2026-11-15 实装）：音色随引擎联动；
          未配置密钥的引擎禁用并标注（诚实接线，AGENTS.md §8） */}
      <SettingsRow label="朗读引擎" hint="消息气泡朗读按钮使用的合成服务">
        <select
          value={tts.engine}
          onChange={(e) => setTtsEngine(e.target.value as TtsEngineId)}
          className="max-w-56 cursor-pointer truncate rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60 max-md:w-full max-md:max-w-full"
        >
          {TTS_ENGINES.map((engine) => {
            const unavailable = ttsEngines !== null && !ttsEngines[engine.id];
            return (
              <option key={engine.id} value={engine.id} disabled={unavailable}>
                {engine.label}
                {unavailable ? '（未配置密钥）' : ''}
              </option>
            );
          })}
        </select>
      </SettingsRow>
      <SettingsRow label="朗读音色" hint="随朗读引擎联动；切换引擎时自动回落默认音色">
        <select
          value={tts.voice}
          onChange={(e) => updateSettings({ tts: { engine: tts.engine, voice: e.target.value } })}
          className="max-w-56 cursor-pointer truncate rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60 max-md:w-full max-md:max-w-full"
        >
          {getTtsEngine(tts.engine)?.voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.label}
            </option>
          ))}
        </select>
      </SettingsRow>
    </div>
  );
}
