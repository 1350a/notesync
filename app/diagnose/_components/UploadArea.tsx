'use client';

import { useMemo, useRef, useState } from 'react';

import ModelSelect from '@/components/ModelSelect';
import { useModels } from '@/hooks/useModels';
import { detectFile } from '@/lib/diagnose/detect';
import { extractAttachment } from '@/lib/diagnose/extract';
import type { DiagnoseKind, ReviseCategory } from '@/lib/diagnose/types';
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
  const updateSettings = useSettingsStore((s) => s.update);

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
  /** 当前模型不接受图片时，图片会被服务端降级为文字占位，提前告知用户 */
  const imageDowngraded = currentModel?.acceptsImages === false;

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
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const readyRows = rows.filter((row) => row.supported && (row.dataUrl || row.text));
  const blockedCount = rows.length - readyRows.length;

  /** 提交：把提取结果按四类标签发给 /api/chat，服务端负责组装成模型消息 */
  const handleSubmit = async () => {
    if (readyRows.length === 0 || isSending || !selectedModel) return;
    setIsSending(true);
    setResult('');
    setError('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          attachments: readyRows.map((row) => ({
            name: row.name,
            category: row.category,
            dataUrl: row.dataUrl,
            text: row.text,
            warning: row.warning,
          })),
        }),
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
      {/* 诊断模型：真实清单来自 GET /api/models，选中值随请求上行 */}
      <div className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 rounded-2xl shadow-sm border border-slate-200">
        <span className="text-sm font-medium text-slate-700">诊断模型</span>
        <ModelSelect
          models={models}
          providers={providers}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
          loading={modelsLoading}
          disabled={isSending}
          emptyHint={modelsError ?? modelsMessage}
          className="max-w-[280px] border border-slate-200"
        />
        {models.length === 0 ? (
          <span className="min-w-0 flex-1 truncate text-xs text-red-500" title={modelsError ?? modelsMessage}>
            {modelsError ?? modelsMessage ?? '暂无可选模型'}
          </span>
        ) : (
          <span className="text-xs text-slate-500">
            {imageDowngraded
              ? '该模型标注为仅文本，图片会转为文字占位后再发送'
              : '图片将按多模态直接发送；若该模型实际不吃图片，会返回明确的错误提示'}
          </span>
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
        className={`relative flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${
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
                      ? '图片已就绪'
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
            onClick={handleSubmit}
            disabled={readyRows.length === 0 || isSending || !selectedModel}
            className="w-full py-4 mt-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {isSending ? '正在诊断…' : `开始诊断（${readyRows.length} 个文件）`}
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

      {(result || error) && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-3">诊断结果</h3>
          {error ? (
            <p className="text-sm text-red-600 whitespace-pre-wrap">{error}</p>
          ) : (
            <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{result}</pre>
          )}
        </div>
      )}
    </div>
  );
}
