'use client';

import { useMemo, useRef, useState } from 'react';

import ModelSelect from '@/components/ModelSelect';
import { useModels } from '@/hooks/useModels';
import { detectFile } from '@/lib/diagnose/detect';
import { extractAttachment } from '@/lib/diagnose/extract';
import type { DiagnoseKind, DiagnosisResult, ReviseCategory } from '@/lib/diagnose/types';
import { getUserId } from '@/lib/client-id';
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
  { id: 'origin', label: '错题原题', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { id: 'wrong', label: '错误答案', color: 'bg-red-100 text-red-700 border-red-200' },
  { id: 'correct', label: '正确答案', color: 'bg-green-100 text-green-700 border-green-200' },
  { id: 'analysis', label: '标准解析', color: 'bg-purple-100 text-purple-700 border-purple-200' },
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
  /** 中性提示（如混合档 OCR 失败但原图仍上行）：与 error 的红框区分，不阻断流程 */
  const [notice, setNotice] = useState('');
  /** 诊断模式：single 单题（对话式组装）/ paper 整卷（四步流程，agent-workflow.md §5） */
  const [mode, setMode] = useState<'single' | 'paper'>('single');
  const [paperView, setPaperView] = useState<PaperViewState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const preferLocalOcr = useSettingsStore((s) => s.settings.ocr.preferLocal);
  const ocrEngine = useSettingsStore((s) => s.settings.ocr.engine);
  const updateSettings = useSettingsStore((s) => s.update);
  /** 图片发送方式当次覆盖（会话级，不落盘；null = 按设置与模型能力派生） */
  const [ocrOverride, setOcrOverride] = useState<ImageSendMode | null>(null);
  /** 本地 OCR 进行中进度（提交阶段）；非 null 时阻断重复提交 */
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null);

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
  /** 只有模型明确声明支持图片，直传与混合两档才成立（product-vision.md P4 约束②；
   *  模型清单未返回能力字段时不渲染这两档，避免用户选了必定失败的档位） */
  const canDirect = currentModel?.acceptsImages === true;
  const requestedMode = ocrOverride ?? resolveImageSendMode(currentModel, preferLocalOcr);
  // 覆盖项可能来自上一张图 / 上一个模型，能力不足时回落全本地，不留失配状态
  const imageMode: ImageSendMode =
    requestedMode !== 'local-ocr' && !canDirect ? 'local-ocr' : requestedMode;

  /** 加入文件：先判定类型，再把可支持的文件送去提取内容 */
  const addFiles = async (incoming: File[]) => {
    const drafts = incoming.map((file) => {
      const detected = detectFile(file.name, file.type);
      const row: Row = {
        id: crypto.randomUUID(),
        name: file.name,
        category: 'origin',
        kind: detected.kind,
        supported: detected.supported,
        status: detected.supported ? 'extracting' : 'failed',
        warning: detected.reason,
      };
      return { file, detected, row };
    });

    setRows((prev) => [...prev, ...drafts.map((d) => d.row)]);

    for (const { file, detected, row } of drafts) {
      if (!detected.supported) continue;
      const attachment = await extractAttachment(file, row.category, detected.kind);
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
    const next = rows.filter((row) => row.id !== id);
    setRows(next);
    // 图片行清空即撤销当次覆盖（事件内重置，不用 effect），下次添加图片重新派生
    if (!next.some((row) => row.dataUrl)) setOcrOverride(null);
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
    setNotice('');
    setPaperView(null);

    try {
      let prepared = readyRows;
      const imageRows = readyRows.filter((row) => row.dataUrl);
      // 全本地与混合两档都要先跑 OCR（引擎由 ocr.engine 决定，doc/cloud-ocr.md §6），差别只在原图是否随请求上行
      if ((imageMode === 'local-ocr' || imageMode === 'mixed') && imageRows.length > 0) {
        setOcrProgress({ done: 0, total: imageRows.length });
        const ocrResult = await convertImagesToTexts(
          imageRows.map((row) => row.dataUrl!),
          (done, total) => setOcrProgress({ done, total }),
          ocrEngine
        );
        setOcrProgress(null);
        if (ocrResult.failures.length > 0) {
          const names = ocrResult.failures.map((f) => imageRows[f.index].name).join('、');
          const engineLabel = ocrEngine === 'cloud' ? '云端' : '本地';
          if (imageMode === 'local-ocr') {
            // 全本地：识别文本是唯一通道，失败即无内容可发 → 阻断，由用户决策
            // （doc/browser-local-ocr.md §6.4：绝不静默丢图片内容、绝不静默切换引擎）
            setError(
              `${engineLabel}OCR未能识别：${names}（${ocrResult.failures[0].reason}）。可移除该文件或${
                canDirect ? '改用「直传原图」' : '在设置中切换识别引擎后重试'
              }。`
            );
            return;
          }
          // 混合：原图仍会随请求上行，内容没丢 → 不阻断，只提示该文件降级为纯原图
          setNotice(
            `${engineLabel}OCR未能识别：${names}（${ocrResult.failures[0].reason}）。该文件本次只上传原图，不影响诊断。`
          );
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
            // 全本地：原图不上行（纯文本附件通道）；
            // 混合：OCR 文本打底 + 原图同时上行，服务端按 mixed 组装（doc/diagnose-file-intake.md §6）
            dataUrl: imageMode === 'mixed' ? row.dataUrl : undefined,
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
        className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm w-fit"
        role="group"
        aria-label="诊断模式"
      >
        <button
          type="button"
          disabled={isSending}
          onClick={() => setMode('single')}
          className={`px-4 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 touch:px-5 touch:py-2.5 ${
            mode === 'single' ? 'bg-blue-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-50'
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
            mode === 'paper' ? 'bg-blue-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-50'
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
      <div className="flex flex-col gap-3 bg-white px-4 py-3 rounded-2xl shadow-sm border border-slate-200 md:flex-row md:flex-wrap md:items-center">
        <span className="text-sm font-medium text-slate-700 md:shrink-0">诊断模型</span>
        <ModelSelect
          models={models}
          providers={providers}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
          loading={modelsLoading}
          disabled={isSending}
          emptyHint={modelsError ?? modelsMessage}
          className="w-full border border-slate-200 touch:min-h-11 touch:text-base md:w-auto md:max-w-[280px]"
        />
        {models.length === 0 ? (
          <span
            className="w-full break-words text-xs text-red-500 md:min-w-0 md:flex-1 md:truncate"
            title={modelsError ?? modelsMessage}
          >
            {modelsError ?? modelsMessage ?? '暂无可选模型'}
          </span>
        ) : (
          <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-0 md:flex-1 md:flex-row md:items-center">
            {/* 图片发送方式：默认按模型能力与设置派生，可当次切换（doc/browser-local-ocr.md §6.1） */}
            <div
              className="flex w-full items-center overflow-hidden rounded-md border border-slate-200 text-[11px] touch:text-xs md:w-auto md:shrink-0"
              role="group"
              aria-label="图片发送方式"
            >
              {/* 三档：直传原图 / OCR转文字 / 混合。后两档中的直传与混合都依赖模型图片能力，
                  能力不明时只留「OCR转文字」，避免摆出选了必定失败的选项（product-vision.md P4 约束②） */}
              {canDirect && (
                <button
                  type="button"
                  disabled={isSending || ocrProgress !== null}
                  onClick={() => setOcrOverride('direct')}
                  className={`flex-1 px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60 touch:py-2.5 md:flex-none ${
                    imageMode === 'direct'
                      ? 'bg-slate-100 font-medium text-slate-800'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                  title="图片原图随附件直传（需所选模型支持多模态）"
                >
                  直传原图
                </button>
              )}
              <button
                type="button"
                disabled={isSending || ocrProgress !== null}
                onClick={() => setOcrOverride('local-ocr')}
                className={`flex-1 px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60 touch:py-2.5 md:flex-none ${
                  imageMode === 'local-ocr'
                    ? 'bg-slate-100 font-medium text-slate-800'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
                // 代价文案随引擎：云端引擎下图片像素上行至智谱 OCR（doc/cloud-ocr.md §3）
                title={
                  ocrEngine === 'cloud'
                    ? '图片经云端OCR（智谱 glm-ocr）转文字再发送：公式/手写识别更好，但图片将上传至智谱'
                    : '图片先在浏览器本地OCR转文字再发送：纯文本模型可用，原图不出设备（隐私、省token）'
                }
              >
                {ocrEngine === 'cloud' ? '云端转文字' : 'OCR转文字'}
              </button>
              {canDirect && (
                <button
                  type="button"
                  disabled={isSending || ocrProgress !== null}
                  onClick={() => setOcrOverride('mixed')}
                  className={`flex-1 px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60 touch:py-2.5 md:flex-none ${
                    imageMode === 'mixed'
                      ? 'bg-slate-100 font-medium text-slate-800'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                  title="本地OCR文本打底 + 原图同传：识别不准时模型仍能看图，代价是原图也出设备"
                >
                  混合
                </button>
              )}
            </div>
            {/* P4 约束①：代价必须写在选择处（触屏无 hover）；
                safety-protocol.md §7：外发档明示「图片上传至模型服务商」 */}
            <span
              className={`w-full break-words text-xs md:min-w-0 md:flex-1 ${
                imageMode === 'local-ocr' && ocrEngine === 'local' ? 'text-slate-500' : 'text-amber-600'
              }`}
            >
              {imageMode === 'local-ocr'
                ? ocrEngine === 'cloud'
                  ? '图片将上传至智谱 OCR（glm-ocr）转文字后发送：公式/手写识别更好，但原图像素出设备'
                  : '图片经浏览器本地识别转文字后发送（原图不出设备）；但用不到原图理解，图文混排 / 手写可能识别有误'
                : imageMode === 'mixed'
                  ? `混合：${ocrEngine === 'cloud' ? '云端' : '本地'}识别打底 + 原图一并上传至模型服务商（外发最多，识别不准时仍能看图）；若该模型实际不吃图片，会返回明确的错误提示`
                  : '多模态：图片将上传至模型服务商；若该模型实际不吃图片，会返回明确的错误提示'}
            </span>
          </div>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center p-6 md:p-12 border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:bg-slate-50'
        }`}
      >
        <input
          type="file"
          multiple
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileSelect}
        />
        <div className="text-4xl mb-4">📁</div>
        <p className="text-lg font-medium text-slate-700">点击或拖拽文件到这里</p>
        <p className="text-sm text-slate-500 mt-2">支持图片 / PDF / 纯文本，Word 暂不支持</p>
      </div>

      {rows.length > 0 && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          <h3 className="font-semibold text-slate-800">已上传文件 ({rows.length})</h3>

          <div className="space-y-3">
            {rows.map((row) => {
              const current = CATEGORIES.find((item) => item.id === row.category) ?? CATEGORIES[0];
              const statusText =
                row.status === 'extracting'
                  ? '正在提取内容…'
                  : row.status === 'ready'
                    ? row.dataUrl
                      ? imageMode === 'local-ocr'
                        ? `图片已就绪（发送时${ocrEngine === 'cloud' ? '云端OCR' : '本地OCR'}转文字）`
                        : imageMode === 'mixed'
                          ? `图片已就绪（发送时${ocrEngine === 'cloud' ? '云端' : '本地'}OCR打底 + 原图同传）`
                          : '图片已就绪'
                      : `文字已提取（${row.text?.length ?? 0} 字符）`
                    : null;
              return (
                <div
                  key={row.id}
                  className={`p-3 rounded-xl border ${
                    row.status === 'failed'
                      ? 'bg-red-50 border-red-100'
                      : 'bg-slate-50 border-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 truncate">
                      <span className="text-xl">📄</span>
                      <span className="text-sm text-slate-700 truncate max-w-50">{row.name}</span>
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
                        className="text-slate-400 hover:text-red-500 transition-colors p-2"
                        title="移除文件"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {statusText && (
                    <p className="mt-2 text-xs text-slate-500 pl-9">{statusText}</p>
                  )}
                  {row.warning && (
                    <p className="mt-2 text-xs text-red-600 pl-9">{row.warning}</p>
                  )}
                </div>
              );
            })}
          </div>

          {blockedCount > 0 && (
            <p className="text-xs text-amber-600">
              有 {blockedCount} 个文件不会被发送（类型不支持或未提取到内容）
            </p>
          )}

          <button
            onClick={() => void handleSubmit()}
            disabled={readyRows.length === 0 || isSending || !selectedModel || ocrProgress !== null}
            className="w-full py-4 mt-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
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
            <p className="text-xs text-slate-500">至少需要 1 个已成功提取内容的文件才能开始诊断</p>
          )}
          {readyRows.length > 0 && !selectedModel && (
            <p className="text-xs text-red-500">
              没有可用模型，无法开始诊断：请在 .env.local 配置任一 Provider（DEEPSEEK_API_KEY /
              ZHIPU_API_KEY / CUSTOM_API_KEY+BASE_URL），或确认本地模型服务（如 Ollama）已启动后重启服务。
            </p>
          )}
        </div>
      )}

      {notice && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-amber-200">
          <p className="text-sm text-amber-700 whitespace-pre-wrap">{notice}</p>
        </div>
      )}

      {error && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <p className="text-sm text-red-600 whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {paperView && paperView.steps.length > 0 && <PaperResultPanel view={paperView} />}

      {!paperView && result && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-3">诊断结果</h3>
          <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{result}</pre>
        </div>
      )}
    </div>
  );
}
