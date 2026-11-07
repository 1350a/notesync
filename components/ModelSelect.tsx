'use client';

import type { ProviderModel, ProviderStatus } from '@/lib/provider/types';
import { useMemo } from 'react';

export interface ModelSelectProps {
  /** 真实可用模型列表（来自 GET /api/models，非硬编码） */
  models: ProviderModel[];
  /** 当前选中模型名（受控） */
  selectedModel: string;
  onModelChange: (model: string) => void;
  /** 各 Provider 明细状态（下拉分组标注用） */
  providers?: ProviderStatus[];
  /** 模型列表加载中 */
  loading?: boolean;
  /** 额外禁用态（生成中 / 提交中） */
  disabled?: boolean;
  /** 无可用模型时的悬停提示 */
  emptyHint?: string;
  className?: string;
}

/** 仅文本能力的模型在下拉里标注，避免用户以为能发图 */
function optionLabel(model: ProviderModel): string {
  return model.acceptsImages === false ? `${model.name}（仅文本）` : model.name;
}

/**
 * 受控模型下拉：数据一律来自 GET /api/models，按 Provider 分组，无模型时禁用并提供原因。
 * 聊天页与诊断页共用，避免两处各写一份假/真不一的下拉。
 */
export default function ModelSelect({
  models,
  selectedModel,
  onModelChange,
  providers,
  loading = false,
  disabled = false,
  emptyHint,
  className = '',
}: ModelSelectProps) {
  /** 按 Provider 分组，便于多 Provider 时用 optgroup 区分来源 */
  const modelGroups = useMemo(() => {
    const groups: { key: string; label: string; items: ProviderModel[] }[] = [];
    for (const m of models) {
      const key = m.provider ?? 'unknown';
      const group = groups.find((g) => g.key === key);
      if (group) {
        group.items.push(m);
      } else {
        const label = providers?.find((p) => p.name === m.provider)?.displayName ?? key;
        groups.push({ key, label, items: [m] });
      }
    }
    return groups;
  }, [models, providers]);

  return (
    <select
      value={selectedModel}
      onChange={(e) => onModelChange(e.target.value)}
      disabled={disabled || loading || models.length === 0}
      title={models.length === 0 ? (emptyHint ?? '暂无可用模型') : '选择模型'}
      className={`text-xs bg-muted/50 hover:bg-muted rounded-md px-2 py-1 outline-none border-none cursor-pointer text-muted-foreground font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {models.length === 0 && (
        <option value="">{loading ? '加载模型中…' : '（无可用模型）'}</option>
      )}
      {modelGroups.length === 1
        ? modelGroups[0].items.map((m) => (
            <option key={m.name} value={m.name}>
              {optionLabel(m)}
            </option>
          ))
        : modelGroups.map((g) => (
            <optgroup key={g.key} label={g.label}>
              {g.items.map((m) => (
                <option key={m.name} value={m.name}>
                  {optionLabel(m)}
                </option>
              ))}
            </optgroup>
          ))}
    </select>
  );
}
