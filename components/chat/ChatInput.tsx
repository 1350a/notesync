'use client';

import ModelSelect from '@/components/ModelSelect';
import AiGeneratedNotice from '@/components/chat/AiGeneratedNotice';
import UploadPrivacyNotice from '@/components/upload/UploadPrivacyNotice';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { SendOptions } from '@/hooks/useChat';
import { filePrivacyDetail, imagePrivacyDetail } from '@/lib/ui/notices';
import { MAX_TEXT_FILE_CHARS, type ChatTextFile } from '@/lib/chat/messages';
import { decodeTextBuffer } from '@/lib/intake/decode-text';
import {
  detectIntake,
  FILE_ACCEPT,
  FILE_ACCEPT_NO_IMAGE,
  type OfficeFormat,
} from '@/lib/intake/detect';
import { extractImageIntake } from '@/lib/intake/extract-image';
import { extractOfficeText } from '@/lib/intake/extract-office';
import { extractPdfText } from '@/lib/intake/extract-pdf';
import { parseDocViaServer } from '@/lib/intake/parse-doc-client';
import { THINKING_EFFORTS, type OcrEngine, type ThinkingEffort } from '@/lib/settings/types';
import { useSettingsStore } from '@/store/useSettingsStore';
import {
  convertImagesToTexts,
  resolveImageSendMode,
  type ImageSendMode,
} from '@/lib/ocr/image-handling';
import type { ProviderModel, ProviderStatus } from '@/lib/provider/types';
import { useEffect, useRef, useState } from 'react';

/** 文件选择框的 accept 白名单见 lib/intake/detect.ts 的 FILE_ACCEPT / FILE_ACCEPT_NO_IMAGE
 *  （doc/file-intake.md §9：移动端文件项不含 image/*，避免系统来源选择层） */

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
  /** OCR 转写引擎（ocr.engine，doc/cloud-ocr.md §4）：cloud=智谱 glm-ocr（默认）；local=tesseract 浏览器内。
   *  只在纯文本模型路径生效——多模态模型直传原图、无转写（P4 自动路由，2026-11-14） */
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
  ocrEngine,
  diagnosisActive = false,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<ChatTextFile[]>([]);
  const [hint, setHint] = useState('');
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 移动端相册选图入口（accept=image/* 无 capture，直进照片选择器，doc/file-intake.md §9） */
  const galleryInputRef = useRef<HTMLInputElement>(null);
  /** 移动端快速拍照入口（capture 属性直调系统相机，doc/file-intake.md §9） */
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 触屏（虚拟键盘）Enter 应为换行，发送只靠按钮，避免选字回车误发（doc/mobile-ux.md §4）
  const isCoarsePointer = useMediaQuery('(pointer: coarse)');
  /** OCR 进行中进度；非 null 时阻断重复发送 */
  const [ocrBusy, setOcrBusy] = useState<{ done: number; total: number } | null>(null);
  /**
   * 移动端附件方式列表（doc/file-intake.md §9）：触屏点附件按钮就地展开「文件/拍照」
   * 列表（列表式非弹窗）；桌面点按钮直开文件选择，该状态不参与
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * 首次选文件是否已给过隐私提醒（本次会话一次即可）。
   * 用 ref 不用 state：提醒内容是「一次性告知」，不需要驱动任何渲染分支，
   * 放进 state 只会多一次无意义的重渲染。
   */
  const privacyNotified = useRef(false);
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

  /** 附件入口：桌面直开文件选择；触屏展开列表式三选项（file-intake.md §9） */
  const openPicker = () => {
    if (isCoarsePointer) setPickerOpen((v) => !v);
    else fileInputRef.current?.click();
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

  /** 图片：走 intake 规范化（heic 三级阶梯 / 缩放 / 格式转换，doc/file-intake.md §5~§6） */
  const addImageFile = async (file: File) => {
    const result = await extractImageIntake(file);
    if (!result.ok) {
      pushHint(`${file.name}：${result.reason}`);
      return;
    }
    setImages((prev) => [...prev, result.dataUrl]);
    if (result.format !== result.originalFormat) {
      pushHint(
        `${file.name}：${result.originalFormat.toUpperCase()} 已转为 ${result.format.toUpperCase()} 后添加`
      );
    } else if (result.resized) {
      pushHint(`${file.name} 尺寸较大，已压缩后添加`);
    }
  };

  /** 纯文本文件：编码探测后读出字符串随消息上行（doc/file-intake.md §4），由服务端拼进正文 */
  const readTextFile = async (file: File) => {
    try {
      const decoded = decodeTextBuffer(await file.arrayBuffer());
      if (!decoded.ok) {
        pushHint(`${file.name}：${decoded.reason}`);
        return;
      }
      const text = decoded.text;
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
    } catch {
      pushHint(`读取 ${file.name} 失败，请重试`);
    }
  };

  /** Office 文档：客户端解析成文本随消息上行（docx/pptx/xlsx/xls，doc/file-intake.md §7） */
  const addOfficeFile = async (file: File, format: OfficeFormat) => {
    const result = await extractOfficeText(file, format, MAX_TEXT_FILE_CHARS);
    if (!result.text.trim()) {
      pushHint(`${file.name}：${result.warning ?? '未提取到内容'}`);
      return;
    }
    setFiles((prev) => [...prev, { name: file.name, text: result.text }]);
    if (result.warning) pushHint(`${file.name}：${result.warning}`);
  };

  /** .doc：浏览器无法解析，上传至自有服务端解析（UI 明示，doc/file-intake.md §1/§8） */
  const addDocFile = async (file: File) => {
    pushHint(`${file.name}：doc 需上传服务器解析，处理中…`);
    const result = await parseDocViaServer(file);
    if (!result.ok) {
      pushHint(`${file.name}：${result.reason}`);
      return;
    }
    if (!result.text.trim()) {
      pushHint(`${file.name}：服务端未提取到文字内容`);
      return;
    }
    const truncated = result.text.length > MAX_TEXT_FILE_CHARS;
    setFiles((prev) => [
      ...prev,
      { name: file.name, text: truncated ? result.text.slice(0, MAX_TEXT_FILE_CHARS) : result.text },
    ]);
    if (truncated) pushHint(`${file.name} 超过 ${MAX_TEXT_FILE_CHARS} 字符，已截断后添加`);
  };

  /** PDF：与诊断页共用文字层提取（80 页上限，doc/file-intake.md §7）；扫描件无文字层 */
  const addPdfFile = async (file: File) => {
    try {
      const text = await extractPdfText(file, MAX_TEXT_FILE_CHARS);
      if (!text.trim()) {
        pushHint(`${file.name}：未提取到文字，可能是扫描件 PDF，请截图后按图片上传`);
        return;
      }
      setFiles((prev) => [...prev, { name: file.name, text }]);
    } catch {
      pushHint(`${file.name}：PDF 解析失败，请重试或截图后按图片上传`);
    }
  };

  /** 统一分发：魔数判定优先（iOS 相册 HEIC 转码后扩展名会说谎），doc/file-intake.md §3 */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    if (fileInputRef.current) fileInputRef.current.value = '';
    for (const file of picked) {
      const detected = await detectIntake(file);
      /**
       * 首次选文件的一次性隐私提醒（按实际类型给具体去向，doc/file-intake.md §1 隐私口径）。
       * 只给一次：常驻行（UploadPrivacyNotice）负责长期可见，这里补「详细三点说明」，
       * 每次上传都弹会变成打断式弹窗，反而被用户无视。
       */
      if (!privacyNotified.current) {
        privacyNotified.current = true;
        pushHint(
          detected.category === 'image'
            ? imagePrivacyDetail(imageMode, ocrEngine)
            : filePrivacyDetail(detected.category === 'doc' ? 'doc' : 'other'),
        );
      }
      if (detected.category === 'image') {
        await addImageFile(file);
      } else if (detected.category === 'text') {
        await readTextFile(file);
      } else if (detected.category === 'office') {
        // category === 'office' 时 format 必为 OFFICE_EXTENSIONS 之一（detect 的出口约定）
        await addOfficeFile(file, detected.format as OfficeFormat);
      } else if (detected.category === 'doc') {
        await addDocFile(file);
      } else if (detected.category === 'pdf') {
        await addPdfFile(file);
      } else {
        pushHint(`${file.name}：${detected.reason ?? '不支持的文件类型'}`);
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        // 粘贴图片同样会把像素发往云端（或本地识别），首次粘贴也要给一次性提醒
        if (file && !privacyNotified.current) {
          privacyNotified.current = true;
          pushHint(imagePrivacyDetail(imageMode, ocrEngine));
        }
        if (file) void addImageFile(file);
      }
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const currentModel = models.find((m) => m.name === selectedModel);
  // 图片路径全自动派生（product-vision.md P4，2026-11-14）：多模态直传、其余 OCR 转写。
  // 无当次覆盖、无档位控件——UI 只展示派生结果与代价（诚实接线）
  const imageMode: ImageSendMode = resolveImageSendMode(currentModel);
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
        `第 ${index} 张图${engineLabel}OCR失败：${result.failures[0].reason}。可移除该图或在设置中切换识别引擎后重试`
      );
      return false;
    }
    setOcrDraft({ texts: result.texts as string[], confidences: result.confidences });
    return true;
  };

  const handleSend = async () => {
    if (!hasPayload || loading || ocrBusy || ocrDraft) return;
    // OCR 转写路径：先 OCR → 回显确认；确认面板的发送按钮负责真正的上行
    if (images.length > 0 && imageMode === 'ocr-text') {
      const ok = await runOcrThenConfirm();
      if (!ok) return;
      return; // 等待回显确认，不在此处发送
    }
    doSend(undefined);
  };

  /** 确认面板「确认发送」/ 纯文本与直传路径的实际发送 */
  const doSend = (ocrTexts: string[] | undefined) => {
    const options: SendOptions | undefined = diagnosisMode ? { startDiagnosis: true } : undefined;
    // 不传 imageSendMode：缺省口径即「有 ocrTexts 即全本地」（useChat 兼容语义）。
    // 混合档已下线，客户端不再产出（doc/browser-local-ocr.md §6.2）
    onSend(input.trim(), images, files, ocrTexts, options);
    setInput('');
    setImages([]);
    setFiles([]);
    setHint('');
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
        常驻隐私提醒（上传前可见，不打断）：图片是否出设备随「模型能力 × OCR 引擎」
        派生，文案与发送路径同源（lib/ocr/image-handling.ts imageLeavesDevice）。
        放输入框外一行小字——放进底栏会被窄屏 flex 压成竖排（同上一条教训）。
      */}
      <UploadPrivacyNotice mode={imageMode} engine={ocrEngine} />

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
              ? '输入你的问题，支持上传图片、PDF、文本与 Office 文档'
              : '输入你的问题，支持上传图片、PDF、文本与 Office 文档，回车发送…'
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

        {/* 派生模式提示独占一行：此前与按钮同行，窄屏被 flex 压缩成一字一列的竖排（mobile-ux.md §7 同款教训） */}
        {images.length > 0 && (
          <p
            className={`px-2 text-[10px] leading-snug ${
              imageMode === 'direct' || ocrEngine === 'cloud'
                ? 'text-amber-600'
                : 'text-muted-foreground'
            }`}
          >
            {imageMode === 'direct'
              ? '多模态：原图直传，图片将上传至模型服务商'
              : ocrEngine === 'cloud'
                ? '云端转文字：发送时图片像素上传至智谱 OCR（公式/手写更好），确认识别结果后发送'
                : '本地转文字：发送时浏览器内 OCR，原图不出设备；图文混排/手写可能识别有误'}
          </p>
        )}

        {/* 底栏：左侧附件入口，右侧思考强度与发送 */}
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="flex items-center gap-2">
            {/* 附件入口：桌面直开文件选择；触屏展开列表式三选项（file-intake.md §9）。
                三个 input 的 accept 互不共用：文件项不含 image/*（避免系统来源选择层），
                相册/拍照项均为 image/*，后者加 capture 直调相机。input 置于 Button 外层
                （input 嵌在 button 内属无效嵌套） */}
            <div className="relative">
              <input
                type="file"
                accept={isCoarsePointer ? FILE_ACCEPT_NO_IMAGE : FILE_ACCEPT}
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileSelect}
              />
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                ref={galleryInputRef}
                onChange={handleFileSelect}
              />
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                ref={cameraInputRef}
                onChange={handleFileSelect}
              />
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full h-8 w-8 text-muted-foreground hover:bg-muted touch:h-11 touch:w-11"
                onClick={openPicker}
                disabled={loading}
                aria-expanded={pickerOpen}
                title="上传图片、PDF、文本或 Office 文档"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
              </Button>
              {pickerOpen && (
                <>
                  {/* 透明点击层：点列表外任意处收起（无遮罩变暗，保持就地展开观感） */}
                  <div className="fixed inset-0 z-0" onClick={() => setPickerOpen(false)} />
                  <div
                    role="menu"
                    aria-label="选择上传方式"
                    className="absolute bottom-full left-0 z-10 mb-2 w-44 overflow-hidden rounded-xl border border-border bg-background py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setPickerOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-muted touch:py-3"
                    >
                      <span aria-hidden>📄</span> 选择文件
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setPickerOpen(false);
                        galleryInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-muted touch:py-3"
                    >
                      <span aria-hidden>🖼️</span> 从相册选择
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setPickerOpen(false);
                        cameraInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-muted touch:py-3"
                    >
                      <span aria-hidden>📷</span> 拍照
                    </button>
                  </div>
                </>
              )}
            </div>
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

      {/* 常驻 AI 生成提示：输入框正下方单行小字（纯展示，无 state、不发请求）。
          放输入区之外而不是底栏内：底栏已有附件/思考强度/发送三个控件，
          窄屏再塞文案会被 flex 压成竖排（doc/mobile-ux.md §7 同款教训） */}
      <AiGeneratedNotice />
    </div>
  );
}
