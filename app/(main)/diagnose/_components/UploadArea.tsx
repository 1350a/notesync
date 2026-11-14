'use client';

import { useMemo, useRef, useState } from 'react';

import ModelSelect from '@/components/ModelSelect';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useModels } from '@/hooks/useModels';
import { detectFile } from '@/lib/diagnose/detect';
import { extractAttachment } from '@/lib/diagnose/extract';
import type { DiagnoseKind, DiagnosisResult, ReviseCategory } from '@/lib/diagnose/types';
import { generateId, getUserId } from '@/lib/client-id';
// 单题结果与聊天同为模型输出（受上传文件抽出文本影响），必须走同一套渲染+净化管线，
// 插件顺序约束见 lib/markdown/sanitize.ts 头注
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { rehypeSanitizeMarkdown } from '@/lib/markdown/sanitize';
import PaperResultPanel, { type PaperViewState } from './PaperResultPanel';
import {
  convertImagesToTexts,
  mergeOcrText,
  resolveImageSendMode,
  type ImageSendMode,
} from '@/lib/ocr/image-handling';
import { useSettingsStore } from '@/store/useSettingsStore';

/** 四类上传标签，顺序与组装锚点一致 */
const CATEGORIES: { id: ReviseCategory; label: string; color: string }[] = [
  { id: 'origin', label: '错题原题', color: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40' },
  { id: 'wrong', label: '错误答案', color: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40' },
  { id: 'correct', label: '正确答案', color: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-500/20 dark:text-green-300 dark:border-green-500/40' },
  { id: 'analysis', label: '标准解析', color: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/40' },
];

type RowStatus = 'extracting' | 'ready' | 'failed';

/** 一行 = 一个用户选中的文件，内容在选中后立刻提取，提交时直接用提取结果 */
interface Row {
  id: string;
  name: string;
  category: ReviseCategory;
  kind: DiagnoseKind;
  /** detect 判定是否接得住；false 时不允许提交 */
  supported: boolean;
  status: RowStatus;
  dataUrl?: string;
  text?: string;
  /** 降级/拒收原因，直接展示给用户 */
  warning?: string;
}

/** 逐块消费 SSE，按事件名分发；解析失败的块直接跳过（上游可能下发心跳） */
async function consumeSse(
  res: Response,
  onEvent: (event: string, data: unknown) => void
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('响应缺少 body');

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const lines = chunk.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event:'));
      const dataLine = lines.find((line) => line.startsWith('data:'));
      if (!eventLine || !dataLine) continue;
      const event = eventLine.slice(6).trim();
      try {
        onEvent(event, JSON.parse(dataLine.slice(5).trim()));
      } catch {
        // 非 JSON 数据行忽略，不影响后续事件
      }
    }
  }
}

export default function UploadArea() {
  const [rows, setRows] = useState<Row[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  /** 诊断模式：single 单题（对话式组装）/ paper 整卷（四步流程，agent-workflow.md §5） */
  const [mode, setMode] = useState<'single' | 'paper'>('single');
  const [paperView, setPaperView] = useState<PaperViewState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 移动端快速拍照入口（capture 属性直调系统相机，doc/file-intake.md §9） */
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const isCoarsePointer = useMediaQuery('(pointer: coarse)');

  // 模型清单与聊天页同源（GET /api/models），不再由服务端隐式取首个模型
  const {
    models,
    providers,
    loading: modelsLoading,
    message: modelsMessage,
    error: modelsError,
  } = useModels();
  const [pickedModel, setPickedModel] = useState('');
  // 默认模型记忆：与聊天页共用设置里的 defaultModel（doc/user-settings.md §5）
  const defaultModel = useSettingsStore((s) => s.settings.defaultModel);
  const ocrEngine = useSettingsStore((s) => s.settings.ocr.engine);
  const updateSettings = useSettingsStore((s) => s.update);
  /** OCR 进行中进度（提交阶段）；非 null 时阻断重复提交 */
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null);
  /**
   * 移动端附件方式列表（doc/file-intake.md §9）：触屏点上传区就地展开「文件/拍照」
   * 列表（列表式非弹窗）；桌面点上传区直开文件选择，该状态不参与
   */
  const [pickerOpen, setPickerOpen] = useState(false);

  // 派生选中值：用户手选的仍有效则沿用；否则用设置里的默认模型（也须在列表中）；
  // 再回落到首个可用模型（不保留过期模型名）
  const selectedModel = useMemo(() => {
    if (models.length === 0) return '';
    if (pickedModel && models.some((m) => m.name === pickedModel)) return pickedModel;
    if (defaultModel && models.some((m) => m.name === defaultModel)) return defaultModel;
    return models[0].name;
  }, [models, pickedModel, defaultModel]);

  /** 用户手动换模型即视为新的默认偏好，与聊天页共享同一份记忆 */
  const handleModelChange = (model: string) => {
    setPickedModel(model);
    updateSettings({ defaultModel: model });
  };

  const currentModel = models.find((m) => m.name === selectedModel);
  // 图片路径全自动派生（product-vision.md P4，2026-11-14）：多模态直传、其余 OCR 转写。
  // 无当次覆盖与档位控件——UI 只展示派生结果与代价（诚实接线）
  const imageMode: ImageSendMode = resolveImageSendMode(currentModel);

  /** 加入文件：先判定类型（魔数嗅探，异步），再把可支持的文件送去提取内容 */
  const addFiles = async (incoming: File[]) => {
    const drafts = await Promise.all(
      incoming.map(async (file) => {
        const detected = await detectFile(file);
        const row: Row = {
          // generateId 带非 secure context 降级：裸调 crypto.randomUUID 在局域网 http 下
          // 抛 TypeError，且 addFiles 的 rejection 被 handleFileSelect 静默吞掉（2026-11-14）
          id: generateId(),
          name: file.name,
          category: 'origin',
          kind: detected.kind,
          supported: detected.supported,
          status: detected.supported ? 'extracting' : 'failed',
          warning: detected.reason,
        };
        return { file, detected, row };
      })
    );

    setRows((prev) => [...prev, ...drafts.map((d) => d.row)]);

    for (const { file, detected, row } of drafts) {
      if (!detected.supported) continue;
      const attachment = await extractAttachment(file, row.category, detected.kind, detected.format);
      const ready = Boolean(attachment.dataUrl || attachment.text);
      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id
            ? {
                ...item,
                dataUrl: attachment.dataUrl,
                text: attachment.text,
                warning: attachment.warning,
                status: ready ? 'ready' : 'failed',
              }
            : item
        )
      );
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    // 清空 input.value，保证同一个文件可以再次选择触发 onChange
    e.target.value = '';
    void addFiles(picked);
  };

  const changeCategory = (id: string, category: ReviseCategory) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, category } : row)));
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  /** 上传区入口：桌面直开文件选择；触屏展开列表式两选项（file-intake.md §9） */
  const openPicker = () => {
    if (isCoarsePointer) setPickerOpen((v) => !v);
    else fileInputRef.current?.click();
  };

  const readyRows = rows.filter((row) => row.supported && (row.dataUrl || row.text));
  const blockedCount = rows.length - readyRows.length;

  /** 提交：把提取结果按四类标签发给诊断端点，服务端负责组装成模型消息。
   *  single → /api/chat（单题对话式）；paper → /api/diagnose-paper（四步整卷流程）。
   *  OCR 模式下图片行先在浏览器本地转文字，再以纯文本附件上行（原图不出设备） */
  const handleSubmit = async () => {
    if (readyRows.length === 0 || isSending || !selectedModel || ocrProgress) return;
    setIsSending(true);
    setResult('');
    setError('');
    setPaperView(null);

    try {
      let prepared = readyRows;
      const imageRows = readyRows.filter((row) => row.dataUrl);
      // OCR 转写路径（引擎由 ocr.engine 决定，doc/cloud-ocr.md §6）：仅纯文本模型走到这里，
      // 多模态模型直传原图不经过转写（product-vision.md P4 自动路由）
      if (imageMode === 'ocr-text' && imageRows.length > 0) {
        setOcrProgress({ done: 0, total: imageRows.length });
        const ocrResult = await convertImagesToTexts(
          imageRows.map((row) => row.dataUrl!),
          (done, total) => setOcrProgress({ done, total }),
          ocrEngine
        );
        setOcrProgress(null);
        if (ocrResult.failures.length > 0) {
          // 识别文本是唯一通道：失败阻断提交，由用户决策（doc/browser-local-ocr.md §6.4：
          // 绝不静默丢图片内容、绝不静默切换引擎；旧混合档"只传原图"分支已随混合档下线）
          const names = ocrResult.failures.map((f) => imageRows[f.index].name).join('、');
          const engineLabel = ocrEngine === 'cloud' ? '云端' : '本地';
          setError(
            `${engineLabel}OCR未能识别：${names}（${ocrResult.failures[0].reason}）。可移除该文件或在设置中切换识别引擎后重试。`
          );
          return;
        }
        const textByRow = new Map(
          imageRows.map((row, i) => [row.id, ocrResult.texts[i] as string | null] as const)
        );
        prepared = readyRows.map((row) => {
          const ocrText = textByRow.get(row.id);
          if (!ocrText) return row;
          return {
            ...row,
            text: mergeOcrText(row.text, ocrText),
            // OCR 路径原图不上行（纯文本附件通道），缩略预览仍在本地保留
            dataUrl: undefined,
          };
        });
      }

      const payload = {
        model: selectedModel,
        attachments: prepared.map((row) => ({
          name: row.name,
          category: row.category,
          dataUrl: row.dataUrl,
          text: row.text,
          warning: row.warning,
        })),
        user: getUserId() || undefined,
      };

      if (mode === 'paper') {
        const view: PaperViewState = { steps: [], results: [], summary: '' };
        const res = await fetch('/api/diagnose-paper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
        await consumeSse(res, (event, data) => {
          const p = data as {
            step?: string;
            current?: number;
            total?: number;
            result?: DiagnosisResult;
            questionNumbers?: string[];
            groupCode?: string;
            delta?: string;
            error?: string;
          };
          if (event === 'paper_step' && p.step) {
            view.steps = [...view.steps, { text: p.step, current: p.current, total: p.total }];
            setPaperView({ ...view });
          } else if (event === 'diagnosis' && p.result) {
            view.results = [
              ...view.results,
              { result: p.result, questionNumbers: p.questionNumbers ?? [], groupCode: p.groupCode ?? '' },
            ];
            setPaperView({ ...view });
          } else if (event === 'content' && p.delta) {
            view.summary += p.delta;
            setPaperView({ ...view });
          } else if (event === 'error') {
            setError(p.error ?? '整卷诊断失败');
          }
        });
        return;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);

      await consumeSse(res, (event, data) => {
        const payload = data as { delta?: string; error?: string };
        if (event === 'content' && payload.delta) {
          setResult((prev) => prev + payload.delta);
        } else if (event === 'error') {
          setError(payload.error ?? '诊断请求失败');
        }
      });
      setResult((prev) => prev || '服务端未返回任何内容，请检查模型配置或稍后重试。');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* 诊断模式：单题对话式 / 整卷四步流程（agent-workflow.md §5） */}
      <div
        className="flex items-center overflow-hidden rounded-xl border border-border bg-card text-sm shadow-sm w-fit"
        role="group"
        aria-label="诊断模式"
      >
        <button
          type="button"
          disabled={isSending}
          onClick={() => setMode('single')}
          className={`px-4 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 touch:px-5 touch:py-2.5 ${
            mode === 'single' ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
          }`}
          title="单题：逐题对话式诊断，支持追问与分级提示"
        >
          单题诊断
        </button>
        <button
          type="button"
          disabled={isSending}
          onClick={() => setMode('paper')}
          className={`px-4 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 touch:px-5 touch:py-2.5 ${
            mode === 'paper' ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
          }`}
          title="整卷：切题 → 分类 → 同类共享诊断 → 汇总（同类题只诊断一次，省 token）"
        >
          整卷诊断
        </button>
      </div>

      {/* 诊断模型：真实清单来自 GET /api/models，选中值随请求上行。
          窄屏（<md）纵向堆叠，标签 / 下拉 / 图片方式各占整行：
          此前三者挤在同一弹性行里，图片方式的容器被压到 6~19px 宽，
          长文案逐字竖排、按钮组被 overflow-hidden 裁掉（doc/mobile-ux.md §7）。 */}
      <div className="flex flex-col gap-3 bg-card px-4 py-3 rounded-2xl shadow-sm border border-border md:flex-row md:flex-wrap md:items-center">
        <span className="text-sm font-medium text-foreground md:shrink-0">诊断模型</span>
        <ModelSelect
          models={models}
          providers={providers}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
          loading={modelsLoading}
          disabled={isSending}
          emptyHint={modelsError ?? modelsMessage}
          className="w-full border border-border touch:min-h-11 touch:text-base md:w-auto md:max-w-[280px]"
        />
        {models.length === 0 ? (
          <span
            className="w-full break-words text-xs text-destructive md:min-w-0 md:flex-1"
            title={modelsError ?? modelsMessage}
          >
            {modelsError ?? modelsMessage ?? '暂无可选模型'}
          </span>
        ) : (
          // 图片路径全自动派生（product-vision.md P4，2026-11-14）：无档位控件，
          // 只展示派生结果。P4 约束①：外发代价写在发送处（触屏无 hover）
          <span
            className={`w-full break-words text-xs md:min-w-0 md:flex-1 ${
              imageMode === 'direct' || ocrEngine === 'cloud' ? 'text-amber-600' : 'text-muted-foreground'
            }`}
          >
            {imageMode === 'direct'
              ? '多模态：图片原图将上传至模型服务商'
              : ocrEngine === 'cloud'
                ? '云端转文字：提交时图片像素上传至智谱 OCR（glm-ocr）转写后发送，公式/手写识别更好'
                : '本地转文字：提交时图片在浏览器内 OCR 转文字后发送（原图不出设备）；图文混排/手写可能识别有误'}
          </span>
        )}
      </div>

      {/* 上传区：桌面点按直开文件选择；触屏展开列表式两选项（file-intake.md §9，
          2026-11-14 起取消独立拍照按钮） */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={openPicker}
        className={`relative flex flex-col items-center justify-center p-6 md:p-12 border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${
          isDragging ? 'border-primary bg-accent' : 'border-border bg-card hover:bg-muted'
        }`}
      >
        <input
          type="file"
          multiple
          className="hidden"
          ref={fileInputRef}
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
        <div className="text-4xl mb-4">📁</div>
        <p className="text-lg font-medium text-foreground">点击或拖拽文件到这里</p>
        <p className="text-sm text-muted-foreground mt-2">
          支持图片 / PDF / 纯文本 / Word / PPT / Excel（仅旧版 .doc 需上传服务器解析）
        </p>
        {pickerOpen && (
          <>
            {/* 透明点击层：点列表外任意处收起（stopPropagation 防止冒泡回上传区重新展开） */}
            <div
              className="fixed inset-0 z-0"
              onClick={(e) => {
                e.stopPropagation();
                setPickerOpen(false);
              }}
            />
            <div
              role="menu"
              aria-label="选择上传方式"
              className="absolute bottom-6 left-1/2 z-10 w-44 -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-background py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
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
                onClick={(e) => {
                  e.stopPropagation();
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

      {rows.length > 0 && (
        <div className="bg-card p-6 rounded-2xl shadow-sm border border-border space-y-4">
          <h3 className="font-semibold text-foreground">已上传文件 ({rows.length})</h3>

          <div className="space-y-3">
            {rows.map((row) => {
              const current = CATEGORIES.find((item) => item.id === row.category) ?? CATEGORIES[0];
              const statusText =
                row.status === 'extracting'
                  ? '正在提取内容…'
                  : row.status === 'ready'
                    ? row.dataUrl
                      ? imageMode === 'ocr-text'
                        ? `图片已就绪（提交时${ocrEngine === 'cloud' ? '云端OCR' : '本地OCR'}转文字）`
                        : '图片已就绪（原图直传）'
                      : `文字已提取（${row.text?.length ?? 0} 字符）`
                    : null;
              return (
                <div
                  key={row.id}
                  className={`p-3 rounded-xl border ${
                    row.status === 'failed'
                      ? 'bg-destructive/10 border-destructive/30'
                      : 'bg-muted border-border'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 truncate">
                      <span className="text-xl">📄</span>
                      <span className="text-sm text-foreground truncate max-w-50">{row.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={row.category}
                        onChange={(e) => changeCategory(row.id, e.target.value as ReviseCategory)}
                        className={`text-sm px-3 py-1.5 rounded-lg border font-medium outline-none cursor-pointer ${current.color}`}
                      >
                        {CATEGORIES.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeRow(row.id)}
                        className="text-muted-foreground/70 hover:text-destructive transition-colors p-2"
                        title="移除文件"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {statusText && (
                    <p className="mt-2 text-xs text-muted-foreground pl-9">{statusText}</p>
                  )}
                  {row.warning && (
                    <p className="mt-2 text-xs text-destructive pl-9">{row.warning}</p>
                  )}
                </div>
              );
            })}
          </div>

          {blockedCount > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              有 {blockedCount} 个文件不会被发送（类型不支持或未提取到内容）
            </p>
          )}

          <button
            onClick={() => void handleSubmit()}
            disabled={readyRows.length === 0 || isSending || !selectedModel || ocrProgress !== null}
            className="w-full py-4 mt-4 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors shadow-sm disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
          >
            {ocrProgress
              ? `${ocrEngine === 'cloud' ? '云端OCR识别中' : '本地OCR识别中'} ${ocrProgress.done}/${ocrProgress.total}…`
              : isSending
                ? mode === 'paper'
                  ? '整卷处理中…'
                  : '正在诊断…'
                : mode === 'paper'
                  ? `开始整卷诊断（${readyRows.length} 个文件）`
                  : `开始诊断（${readyRows.length} 个文件）`}
          </button>
          {readyRows.length === 0 && (
            <p className="text-xs text-muted-foreground">至少需要 1 个已成功提取内容的文件才能开始诊断</p>
          )}
          {readyRows.length > 0 && !selectedModel && (
            <p className="text-xs text-destructive">
              没有可用模型，无法开始诊断：请在 .env.local 配置任一 Provider（DEEPSEEK_API_KEY /
              ZHIPU_API_KEY / CUSTOM_API_KEY+BASE_URL）后重启服务。
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="bg-card p-6 rounded-2xl shadow-sm border border-border">
          <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {paperView && paperView.steps.length > 0 && <PaperResultPanel view={paperView} />}

      {!paperView && result && (
        <div className="bg-card p-6 rounded-2xl shadow-sm border border-border">
          <h3 className="font-semibold text-foreground mb-3">诊断结果</h3>
          {/* 此前是 <pre> 直出，模型输出的 **加粗**、公式等标记原样漏出；与 ChatList 同管线渲染 */}
          <div className="markdown-body text-sm text-foreground">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeRaw, rehypeSanitizeMarkdown, rehypeKatex]}
            >
              {result}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
