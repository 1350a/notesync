'use client';

import { useModels } from '@/hooks/useModels';
import type { ModelProbeStatus } from '@/lib/provider/types';

/** Provider 状态的用户可读文案（不暴露 baseUrl / key 等敏感信息） */
const STATUS_TEXT: Record<ModelProbeStatus, { label: string; tone: string }> = {
  ok: { label: '正常', tone: 'bg-green-100 text-green-700' },
  degraded: { label: '降级可用', tone: 'bg-amber-100 text-amber-700' },
  unauthorized: { label: '鉴权失败', tone: 'bg-red-100 text-red-700' },
  unconfigured: { label: '未配置', tone: 'bg-slate-100 text-slate-500' },
};

export default function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  // 配置一律由服务端 .env.local 决定，面板只展示 /api/models 探测到的真实状态
  const { models, providers, status, loading, message, error, reload } = useModels();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg p-6 bg-white rounded-2xl shadow-xl text-slate-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">模型服务状态</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2">
            ✕
          </button>
        </div>

        <div className="space-y-5">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-600 border-b pb-2">
              服务端 Provider 探测结果
            </h3>

            {providers.length === 0 ? (
              <p className="text-sm text-slate-500">
                {loading ? '正在探测…' : (error ?? message ?? '未探测到任何 Provider')}
              </p>
            ) : (
              <ul className="space-y-2">
                {providers.map((p) => {
                  const tone = STATUS_TEXT[p.status] ?? STATUS_TEXT.unconfigured;
                  return (
                    <li
                      key={p.name}
                      className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <span className="flex-1 truncate text-sm text-slate-700">
                        {p.displayName}
                        <span className="ml-2 text-xs text-slate-400">
                          {p.count > 0 ? `${p.count} 个模型` : '无模型'}
                          {p.source === 'fallback' ? ' · 白名单兜底' : ''}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${tone.tone}`}>
                        {tone.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {providers.some((p) => p.reason) && (
              <ul className="space-y-1 text-xs text-slate-500">
                {providers
                  .filter((p) => p.reason)
                  .map((p) => (
                    <li key={`${p.name}-reason`}>
                      {p.displayName}：{p.reason}
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">配置方式</p>
            <p>
              API Key / Base URL 由服务端 .env.local 管理（DEEPSEEK_API_KEY、ZHIPU_API_KEY、
              CUSTOM_API_KEY + CUSTOM_BASE_URL），修改后需重启服务并点击下方“重新检测”。
            </p>
            <p>
              图片发送方式由模型能力自动决定：模型支持多模态时图片直传，不支持时降级为文字占位。
            </p>
            <p>当前可选模型 {models.length} 个，整体状态：{STATUS_TEXT[status]?.label ?? status}。</p>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={() => void reload()}
            disabled={loading}
            className="px-5 py-2 text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-60"
          >
            {loading ? '探测中…' : '重新检测'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
