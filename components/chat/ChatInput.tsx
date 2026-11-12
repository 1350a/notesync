'use client';

import ModelSelect from '@/components/ModelSelect';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { SendOptions } from '@/hooks/useChat';
import { MAX_TEXT_FILE_CHARS, type ChatTextFile } from '@/lib/chat/messages';
import { THINKING_EFFORTS, type OcrEngine, type ThinkingEffort } from '@/lib/settings/types';
import { useSettingsStore } from '@/store/useSettingsStore';
import {
  convertImagesToTexts,
  resolveImageSendMode,
  type ImageSendMode,
} from '@/lib/ocr/image-handling';
import type { ProviderModel, ProviderStatus } from '@/lib/provider/types';
import { useEffect, useRef, useState } from 'react';

/** 允许上传的纯文本扩展名（二进制文档如 pdf/doc/docx 不在此列，避免读成乱码） */
const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log',
  'json', 'jsonl', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'svelte',
  'py', 'ipynb', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs',
  'rb', 'php', 'swift', 'lua', 'pl', 'r', 'm', 'sql',
  'sh', 'bash', 'bat', 'ps1', 'ini', 'toml', 'conf', 'properties', 'tex', 'gitignore',
];

/** 文件选择框的 accept：图片 + 上述纯文本扩展名 */
const ACCEPT = ['image/*', ...TEXT_EXTENSIONS.map((ext) => `.${ext}`)].join(',');

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith('image/')) return false;
  return TEXT_EXTENSIONS.includes(extOf(file.name)) || file.type.startsWith('text/');
}

export interface ChatInputProps {
  /** ocrTexts：OCR 产物（经回显确认后的最终文本）；options 见 SendOptions */
  onSend: (
    text: string,
    images: string[],
    files: ChatTextFile[],
    ocrTexts?: string[],
    options?: SendOptions
  ) => void;
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
  /** 设置页"优先本地OCR"偏好（ocr.preferLocal）：true 时图片一律先转文字 */
  preferLocalOcr: boolean;
  /** OCR 转写引擎（ocr.engine，doc/cloud-ocr.md）：local=tesseract 浏览器内；cloud=智谱 glm-ocr */
  ocrEngine: OcrEngine;
  /** 诊断会话进行中（useChat 上下文非 done）：开关只负责开启新会话，会话内展示状态 */
  diagnosisActive?: boolean;
}

/** OCR 低置信线（0~100，tesseract 口径；A 级假设实测可调）：低于此值确认面板强制标红 */
const OCR_LOW_CONFIDENCE = 60;

const THINKING_LABEL: Record<ThinkingEffort, string> = {
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
};

/** 思考强度选择器（doc/user-settings.md §2.1）：聊天框右下角，持久化到设置 */
function ThinkingEffortSelect({
  value,
  onChange,
  disabled,
}: {
  value: ThinkingEffort;
  onChange: (v: ThinkingEffort) => void;
  disabled: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ThinkingEffort)}
      disabled={disabled}
      aria-label="思考强度"
      title="思考强度：高=答得更准但更慢更贵；关闭=无思维链（部分模型仅支持开/关粒度，自定义端点不发送该参数）"
      className="rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground outline-none touch:px-3 touch:py-2"
    >
      {THINKING_EFFORTS.map((level) => (
        <option key={level} value={level}>
          思考·{THINKING_LABEL[level]}
        </option>
      ))}
    </select>
  );
}

/** OCR 回显确认草稿：识别文本可编辑，确认后才随消息上行（diagnosis-model.md §1.3） */
interface OcrDraft {
  texts: string[];
  confidences: (number | null)[];
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
  preferLocalOcr,
  ocrEngine,
  diagnosisActive = false,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<ChatTextFile[]>([]);
  const [hint, setHint] = useState('');
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 触屏（虚拟键盘）Enter 应为换行，发送只靠按钮，避免选字回车误发（doc/mobile-ux.md §4）
  const isCoarsePointer = useMediaQuery('(pointer: coarse)');
  /** 图片发送方式当次覆盖（会话级，不落盘；null = 按设置与模型能力派生） */
  const [ocrOverride, setOcrOverride] = useState<ImageSendMode | null>(null);
  /** 本地 OCR 进行中进度；非 null 时阻断重复发送 */
  const [ocrBusy, setOcrBusy] = useState<{ done: number; total: number } | null>(null);
  /** 诊断模式开关：开启后发送即开启/延续诊断会话（对话模式主线，product-vision.md §3.3） */
  const [diagnosisMode, setDiagnosisMode] = useState(false);
  /** OCR 回显确认草稿：非 null 时输入区上方出现确认面板，阻断直接发送 */
  const [ocrDraft, setOcrDraft] = useState<OcrDraft | null>(null);
  // 思考强度档位（doc/user-settings.md §2.1）：持久化设置，聊天框右下角快捷切换
  const generation = useSettingsStore((s) => s.settings.generation);
  const thinkingEffort = generation.thinkingEffort ?? 'medium';
  const updateSettings = useSettingsStore((s) => s.update);
  // store.update 是浅合并：必须展开现有 generation，否则其他生成参数会被整体清掉
  const setThinkingEffort = (v: ThinkingEffort) =>
    updateSettings({ generation: { ...generation, thinkingEffort: v } });

  useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);

  /** 短暂展示一行提示（不支持的文件、截断、空文件等） */
  const pushHint = (message: string) => {
    setHint(message);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(''), 4000);
  };

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

  /** 纯文本文件：读出字符串随消息上行，由服务端拼进正文（纯文本模型同样可用） */
  const readTextFile = (file: File) => {
    file
      .text()
      .then((text) => {
        if (!text.trim()) {
          pushHint(`${file.name} 是空文件，已跳过`);
          return;
        }
        const truncated = text.length > MAX_TEXT_FILE_CHARS;
        setFiles((prev) => [
          ...prev,
          { name: file.name, text: truncated ? text.slice(0, MAX_TEXT_FILE_CHARS) : text },
        ]);
        if (truncated) pushHint(`${file.name} 超过 ${MAX_TEXT_FILE_CHARS} 字符，已截断后添加`);
      })
      .catch(() => pushHint(`读取 ${file.name} 失败，请重试`));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach((file) => {
        if (file.type.startsWith('image/')) readFile(file);
        else if (isTextFile(file)) readTextFile(file);
        else pushHint(`暂不支持 ${file.name}：目前仅支持图片与纯文本文件`);
      });
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
    const next = images.filter((_, i) => i !== index);
    setImages(next);
    // 图片清空即撤销当次覆盖，下次贴图重新按设置与模型能力派生（事件内重置，不用 effect）
    if (next.length === 0) setOcrOverride(null);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const currentModel = models.find((m) => m.name === selectedModel);
  // P4 约束②：多模态能力未知/不支持时，全本地是唯一路径——多模态与混合两档不渲染
  const canDirect = currentModel?.acceptsImages === true;
  const derivedMode = resolveImageSendMode(currentModel, preferLocalOcr);
  const imageMode: ImageSendMode = ocrOverride ?? (derivedMode === 'direct' && canDirect ? 'direct' : 'local-ocr');
  const hasPayload = input.trim().length > 0 || images.length > 0 || files.length > 0;

  /** OCR 完成后进入回显确认，而不是直接发送（识别结果必须先经学生确认，§1.3 规则①②） */
  const runOcrThenConfirm = async (): Promise<boolean> => {
    setOcrBusy({ done: 0, total: images.length });
    const result = await convertImagesToTexts(
      images,
      (done, total) => setOcrBusy({ done, total }),
      ocrEngine
    );
    setOcrBusy(null);
    if (result.failures.length > 0) {
      // 失败阻断发送：绝不静默丢图片内容、绝不静默切换引擎，由用户决策
      // （doc/browser-local-ocr.md §6.4、doc/cloud-ocr.md §6）
      const index = result.failures.map((f) => f.index + 1).join('、');
      const engineLabel = ocrEngine === 'cloud' ? '云端' : '本地';
      pushHint(
        `第 ${index} 张图${engineLabel}OCR失败：${result.failures[0].reason}。${
          canDirect ? '可移除该图或改用「直传」' : '可移除该图或在设置中切换识别引擎后重试'
        }`
      );
      return false;
    }
    setOcrDraft({ texts: result.texts as string[], confidences: result.confidences });
    return true;
  };

  const handleSend = async () => {
    if (!hasPayload || loading || ocrBusy || ocrDraft) return;
    // 全本地 / 混合：先 OCR → 回显确认；确认面板的发送按钮负责真正的上行
    if (images.length > 0 && (imageMode === 'local-ocr' || imageMode === 'mixed')) {
      const ok = await runOcrThenConfirm();
      if (!ok) return;
      return; // 等待回显确认，不在此处发送
    }
    doSend(undefined);
  };

  /** 确认面板「确认发送」/ 纯文本与直传路径的实际发送 */
  const doSend = (ocrTexts: string[] | undefined) => {
    const options: SendOptions | undefined = diagnosisMode ? { startDiagnosis: true } : undefined;
    onSend(input.trim(), images, files, ocrTexts, {
      ...options,
      // OCR 产物形态随三档走：混合档原图与文本同上行（doc/browser-local-ocr.md §6.2）
      ...(ocrTexts ? { imageSendMode: imageMode === 'mixed' ? ('mixed' as const) : ('local-only' as const) } : {}),
    });
    setInput('');
    setImages([]);
    setFiles([]);
    setHint('');
    setOcrOverride(null);
    setOcrDraft(null);
  };

  /** 确认面板编辑某张图的识别文本 */
  const updateDraftText = (index: number, text: string) => {
    setOcrDraft((prev) => {
      if (!prev) return prev;
      const texts = [...prev.texts];
      texts[index] = text;
      return { ...prev, texts };
    });
  };

  return (
    <div className="mx-auto flex flex-col gap-2 max-w-3xl w-full">
      {/* 附件预览区：图片缩略图 + 文本文件 chip */}
      {(images.length > 0 || files.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-2">
          {images.map((img, idx) => (
            <div key={`img-${idx}`} className="relative group">
              {/* 预览图是 FileReader 读出的 data URL：next/image 的优化器只接可路由的 URL，
                  data URL 属于内联 src，会被判为非法并报错；且缩略图固定 64px，无优化收益 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img}
                alt="preview"
                className="h-16 w-16 object-cover rounded-lg border border-border shadow-sm"
              />
              {/* 删除按钮常显：hover 驱动在触屏上永远不可见（doc/mobile-ux.md §4） */}
              <button
                onClick={() => removeImage(idx)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 touch:h-6 touch:w-6 touch:text-sm transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
          {files.map((file, idx) => (
            <div
              key={`file-${idx}`}
              className="relative group flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-xs"
              title={`${file.name}（${file.text.length} 字符）`}
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5l5 5v11a2 2 0 01-2 2z"
                />
              </svg>
              <span className="max-w-[140px] truncate">{file.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {file.text.length >= 1000
                  ? `${(file.text.length / 1000).toFixed(1)}k`
                  : file.text.length}
                字符
              </span>
              <button
                onClick={() => removeFile(idx)}
                className="text-muted-foreground hover:text-red-500 transition-colors"
                aria-label={`移除 ${file.name}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* OCR 回显确认面板（diagnosis-model.md §1.3）：识别文本先经学生确认/修正才上行，
          低置信项标红强制核对；触屏可编辑（touch 16px）。
          标题随引擎切换：云端引擎下图片已出设备，不得保留"未离开设备"陈述（doc/cloud-ocr.md §3） */}
      {ocrDraft && (
        <div className="mx-1 rounded-xl border border-border bg-muted/30 p-3">
          <p className="mb-1 text-xs font-medium text-foreground">
            {ocrEngine === 'cloud'
              ? '请核对云端识别结果（图片已发送至智谱 OCR）'
              : '请核对本地识别结果（图片未离开设备）'}
          </p>
          <p className="mb-2 text-[11px] text-muted-foreground">
            识别可能有误{ocrEngine === 'cloud' ? '' : '，低置信已标红'}；可直接改正后发送。
          </p>
          {ocrDraft.texts.map((text, i) => {
            const conf = ocrDraft.confidences[i];
            const low = conf !== null && conf < OCR_LOW_CONFIDENCE;
            return (
              <div key={i} className="mb-2">
                <p
                  className={`mb-1 text-[11px] ${
                    low ? 'font-medium text-red-500' : 'text-muted-foreground'
                  }`}
                >
                  第 {i + 1} 张
                  {conf !== null ? `（置信度 ${Math.round(conf)}%）` : ''}
                  {low ? ' · 低置信，请重点核对' : ''}
                </p>
                <textarea
                  value={text}
                  onChange={(e) => updateDraftText(i, e.target.value)}
                  rows={Math.min(6, Math.max(2, Math.ceil(text.length / 40)))}
                  className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none touch:text-base"
                />
              </div>
            );
          })}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setOcrDraft(null)}
              disabled={loading}
              className="h-8 px-3 text-xs touch:h-11 touch:px-4"
            >
              取消
            </Button>
            <Button
              onClick={() => doSend(ocrDraft.texts)}
              disabled={loading}
              className="h-8 px-4 text-xs touch:h-11 touch:px-5 bg-foreground text-background hover:bg-foreground/90"
            >
              确认发送
            </Button>
          </div>
        </div>
      )}

      {(hint || ocrBusy) && (
        <div className="px-2 text-[11px] text-amber-600">
          {ocrBusy && (
            <div className="text-muted-foreground">
              {ocrEngine === 'cloud' ? '云端OCR识别中' : '本地OCR识别中'} {ocrBusy.done}/
              {ocrBusy.total}…
            </div>
          )}
          {hint}
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
          <ModelSelect
            models={models}
            providers={providers}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            loading={modelsLoading}
            disabled={loading}
            emptyHint={modelsMessage}
            className="max-w-[220px]"
          />
          {models.length === 0 && modelsMessage && (
            <span className="min-w-0 truncate text-[10px] text-red-500" title={modelsMessage}>
              {modelsMessage}
            </span>
          )}
          {/* 诊断模式开关（对话模式主线，product-vision.md §3.3）：
              开启后发送即开启/延续诊断会话（错因归因，不给答案开场） */}
          <button
            type="button"
            onClick={() => setDiagnosisMode((v) => !v)}
            disabled={loading}
            className={`rounded-md px-2 py-1 text-xs transition-colors touch:px-3 touch:py-2 disabled:cursor-not-allowed disabled:opacity-60 ${
              diagnosisMode || diagnosisActive
                ? 'bg-foreground/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
            title="诊断模式：先定位你为什么错，再按需给分级提示（答案须主动索取）"
          >
            🩺 {diagnosisMode || diagnosisActive ? '诊断中' : '诊断模式'}
          </button>
          {diagnosisActive && (
            <span className="hidden text-[10px] text-muted-foreground sm:inline">会话进行中</span>
          )}
        </div>

        {/* 中间：透明无边框的输入区 */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            // 触屏放开 Enter 给输入法换行；桌面维持回车直发
            if (isCoarsePointer) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          // 提示跟随回车行为：触屏 Enter 只换行，键盘与占位符都不再谎称"发送"（doc/mobile-ux.md §4）
          enterKeyHint={isCoarsePointer ? 'enter' : 'send'}
          placeholder={
            isCoarsePointer
              ? '输入你的问题，支持上传图片与文本文件'
              : '输入你的问题，支持上传图片与文本文件，回车发送…'
          }
          // 关键点：背景透明、无边框、无 resize，去掉所有可能干扰的样式
          // touch 16px：iOS 对 <16px 输入框聚焦时强制放大页面（doc/mobile-ux.md §4）
          className="w-full resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground leading-relaxed min-h-[44px] touch:text-base"
          style={{
            // 清除可能被感染的全局代码块样式
            fontFamily: 'inherit',
            counterReset: 'none',
          }}
        />

        {/* 底栏：左侧上传与图片发送方式，右侧发送 */}
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-8 w-8 text-muted-foreground hover:bg-muted touch:h-11 touch:w-11"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="上传图片或文本文件"
            >
              <input
                type="file"
                accept={ACCEPT}
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
            {/* 三档选择（product-vision.md P4）：全本地 / 多模态 / 混合。
                P4 约束②：多模态能力未知或不支持时只呈现全本地一档，不得表现存在选择 */}
            {images.length > 0 && (
              <div className="flex flex-col gap-1">
                <div
                  className="flex items-center overflow-hidden rounded-md border border-border text-[11px]"
                  role="group"
                  aria-label="图片发送方式"
                >
                  <button
                    type="button"
                    disabled={loading || ocrBusy !== null || ocrDraft !== null}
                    onClick={() => setOcrOverride('local-ocr')}
                    className={`px-2 py-1 touch:px-3 touch:py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      imageMode === 'local-ocr'
                        ? 'bg-foreground/10 font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                    // 代价文案随引擎：云端引擎下原图像素上行至智谱 OCR，"不出设备"仅本地引擎成立（doc/cloud-ocr.md §3）
                    title={
                      ocrEngine === 'cloud'
                        ? '转文字：图片经云端OCR转文字后发送（图片将上传至智谱，公式/手写识别更好）'
                        : '全本地：图片在浏览器内转文字后发送，原图不出设备（隐私、省流量）'
                    }
                  >
                    {ocrEngine === 'cloud' ? '云端转文字' : '全本地'}
                  </button>
                  {canDirect && (
                    <>
                      <button
                        type="button"
                        disabled={loading || ocrBusy !== null || ocrDraft !== null}
                        onClick={() => setOcrOverride('direct')}
                        className={`px-2 py-1 touch:px-3 touch:py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                          imageMode === 'direct'
                            ? 'bg-foreground/10 font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                        title="多模态：原图直传，图片会上传至模型服务商"
                      >
                        多模态
                      </button>
                      <button
                        type="button"
                        disabled={loading || ocrBusy !== null || ocrDraft !== null}
                        onClick={() => setOcrOverride('mixed')}
                        className={`px-2 py-1 touch:px-3 touch:py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                          imageMode === 'mixed'
                            ? 'bg-foreground/10 font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                        }`}
                        title={`混合：${ocrEngine === 'cloud' ? '云端' : '本地'}识别打底 + 原图上传至模型服务商（外发最多，质量最好）`}
                      >
                        混合
                      </button>
                    </>
                  )}
                </div>
                {/* P4 约束①：代价必须写在选择处，不靠 hover 提示（触屏无 hover）；
                    §7 图片上传明示：外发档当次明示图片将离开设备。
                    转文字档的"原图不出设备"仅本地引擎成立，云端引擎必须明示图片出端（doc/cloud-ocr.md §3） */}
                {imageMode === 'local-ocr' && (
                  <span className="text-[10px] text-muted-foreground">
                    {ocrEngine === 'cloud'
                      ? '云端转文字：图片将上传至智谱 OCR 转写（公式/手写更好，原图像素出设备），发送前需确认'
                      : '全本地：原图不出设备；但用不到原图理解，图文混排 / 手写可能识别有误，发送前需确认'}
                  </span>
                )}
                {imageMode === 'direct' && (
                  <span className="text-[10px] text-amber-600">
                    多模态：图片将上传至模型服务商
                  </span>
                )}
                {imageMode === 'mixed' && (
                  <span className="text-[10px] text-amber-600">
                    混合：原图将上传至模型服务商（另有{ocrEngine === 'cloud' ? '云端' : '本地'}识别打底）
                  </span>
                )}
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2">
              <ThinkingEffortSelect value={thinkingEffort} onChange={setThinkingEffort} disabled={loading || ocrBusy !== null} />
              <Button
                onClick={onStop}
                variant="destructive"
                className="rounded-full h-8 px-4 text-xs touch:h-11 touch:px-5"
              >
                停止
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <ThinkingEffortSelect value={thinkingEffort} onChange={setThinkingEffort} disabled={loading || ocrBusy !== null} />
              <Button
                onClick={() => void handleSend()}
                disabled={!hasPayload || !selectedModel || ocrBusy !== null}
                className="rounded-full h-8 px-4 text-xs touch:h-11 touch:px-5 bg-foreground text-background hover:bg-foreground/90"
              >
                发送
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
