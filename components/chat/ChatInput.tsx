'use client';

import { Button } from '@/components/ui/button';
import type { ProviderModel, ProviderStatus } from '@/lib/provider/types';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ChatInputProps {
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
  loading: boolean;
  /** 真实可用模型列表（来自 GET /api/models，非硬编码） */
  models: ProviderModel[];
  /** 当前选中模型名（受控） */
  selectedModel: string;
  onModelChange: (model: string) => void;
  /** 各 Provider 明细状态（模型下拉分组标注用） */
  providers?: ProviderStatus[];
  /** 模型列表加载中 */
  modelsLoading?: boolean;
  /** 无可用模型时的后端提示 */
  modelsMessage?: string;
}

export default function ChatInput({
  onSend,
  onStop,
  loading,
  models,
  selectedModel,
  onModelChange,
  providers,
  modelsLoading = false,
  modelsMessage,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动调整高度的核心逻辑
  useEffect(() => {
    if (textareaRef.current) {
      // 1. 先把高度重置为空（让浏览器重新计算内容的真实高度）
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;

      // 2. 设定最大高度（例如 250px，超过才出现滚动条）
      const maxHeight = 226;

      if (scrollHeight <= maxHeight) {
        // 如果没有超过最大值，高度等于内容高度
        textareaRef.current.style.height = `${scrollHeight}px`;
      } else {
        // 如果超过了，就固定为最大值，内部产生滚动条
        textareaRef.current.style.height = `${maxHeight}px`;
        textareaRef.current.style.overflowY = 'auto';
      }
    }
  }, [input]);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (typeof e.target?.result === 'string') {
        setImages((prev) => [...prev, e.target!.result as string]);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach(readFile);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) readFile(file);
      }
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

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

  const handleSend = () => {
    if ((!input.trim() && images.length === 0) || loading) return;
    onSend(input.trim(), images);
    setInput('');
    setImages([]);
  };

  return (
    <div className="mx-auto flex flex-col gap-2 max-w-3xl w-full">
      {/* 图片预览区 */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img}
                alt="preview"
                className="h-16 w-16 object-cover rounded-lg border border-border shadow-sm"
              />
              <button
                onClick={() => removeImage(idx)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/*
        大外框容器：这是一个带有边框和背景的整体
        它的内部包含了顶部下拉框、中间的文本区、底部的按钮区
      */}
      <div className="flex flex-col rounded-2xl border border-border bg-background p-2 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30 transition-colors">
        {/* 顶栏：模型与模式选择 */}
        <div className="flex items-center gap-2 px-1 pb-2">
          {/* 模型下拉：真实数据来自 GET /api/models，受控 */}
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={loading || models.length === 0}
            title={models.length === 0 ? (modelsMessage ?? '暂无可用模型') : '选择模型'}
            className="max-w-[220px] text-xs bg-muted/50 hover:bg-muted rounded-md px-2 py-1 outline-none border-none cursor-pointer text-muted-foreground font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {models.length === 0 && (
              <option value="">{modelsLoading ? '加载模型中…' : '（无可用模型）'}</option>
            )}
            {modelGroups.length === 1
              ? modelGroups[0].items.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))
              : modelGroups.map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {g.items.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </select>
          {models.length === 0 && modelsMessage && (
            <span className="min-w-0 truncate text-[10px] text-red-500" title={modelsMessage}>
              {modelsMessage}
            </span>
          )}
          {/* 模式下拉：业务逻辑未接入，本轮保持原样，不参与发送参数 */}
          <select className="text-xs bg-muted/50 hover:bg-muted rounded-md px-2 py-1 outline-none border-none cursor-pointer text-muted-foreground font-medium transition-colors">
            <option>解题过程模式</option>
            <option>对话模式</option>
          </select>
        </div>

        {/* 中间：透明无边框的输入区 */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="输入你的问题，支持粘贴图片，回车发送…"
          // 关键点：背景透明、无边框、无 resize，去掉所有可能干扰的样式
          className="w-full resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground leading-relaxed min-h-[44px]"
          style={{
            // 清除可能被感染的全局代码块样式
            fontFamily: 'inherit',
            counterReset: 'none',
          }}
        />

        {/* 底栏：左侧上传，右侧发送 */}
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-8 w-8 text-muted-foreground hover:bg-muted"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="上传图片"
            >
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileSelect}
              />
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                />
              </svg>
            </Button>
          </div>

          {loading ? (
            <Button
              onClick={onStop}
              variant="destructive"
              className="rounded-full h-8 px-4 text-xs"
            >
              停止
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={(!input.trim() && images.length === 0) || !selectedModel}
              className="rounded-full h-8 px-4 text-xs bg-foreground text-background hover:bg-foreground/90"
            >
              发送
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
