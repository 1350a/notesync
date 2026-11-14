'use client';

import SettingsRow, { DISABLED_SELECT_CLASS, NotWiredBadge } from './SettingsRow';
import { useModels } from '@/hooks/useModels';
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
  const updateSettings = useSettingsStore((s) => s.update);
  // 分区挂载时才拉模型列表（弹窗关闭时本组件不渲染，不产生请求）
  const { models, loading } = useModels();

  // store.update 是浅合并：必须展开现有 generation，否则思考档位等参数会被整体清掉
  const setMaxTokens = (raw: string) => {
    const next = { ...generation };
    if (raw === '') delete next.maxTokens;
    else next.maxTokens = Number(raw);
    updateSettings({ generation: next });
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

      {/* 未实装占位：仅展示不可交互（诚实接线，协议 doc/user-settings.md §5/§6）。
          图片处理行已迁入「本地能力」分区（doc/browser-local-inference.md §7）；
          语言行已删（2026-11-14 砍掉多语言方向，见 doc/user-settings.md §6） */}
      <SettingsRow label="朗读音色" badge={<NotWiredBadge />} hint="TTS 能力尚未接入">
        <select disabled className={DISABLED_SELECT_CLASS}>
          <option>暂不可选</option>
        </select>
      </SettingsRow>
    </div>
  );
}
