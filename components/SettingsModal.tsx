'use client';

import { AppSettings, getEffectiveSettings } from '@/lib/config';
import { useState } from 'react';

export default function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  // 直接用初始化函数获取配置，完美避开 useEffect 的同步问题
  const [settings, setSettings] = useState<AppSettings>(() => getEffectiveSettings());

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const p = e.target.value as AppSettings['provider'];
    let baseUrl = '';
    let modelName = '';

    if (p === 'deepseek') {
      baseUrl = 'https://api.deepseek.com';
      modelName = 'deepseek-v4-flash';
    } else if (p === 'zhipu') {
      baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
      modelName = 'glm-5.3';
    }

    setSettings((prev) => ({ ...prev, provider: p, baseUrl, modelName }));
  };

  const handleSave = () => {
    localStorage.setItem('notesync_config', JSON.stringify(settings));
    alert('配置已保存！');
    onClose(); // 保存后关闭
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg p-6 bg-white rounded-2xl shadow-xl text-slate-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">系统设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2">
            ✕
          </button>
        </div>

        <div className="space-y-5">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-600 border-b pb-2">模型服务配置</h3>

            <div>
              <label className="block text-sm text-slate-600 mb-1">服务商</label>
              <select
                value={settings.provider}
                onChange={handleProviderChange}
                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="deepseek">DeepSeek (官方)</option>
                <option value="zhipu">智谱 AI (BigModel)</option>
                <option value="custom">自定义 (OpenAI 兼容)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">
                API Key (留空则使用系统默认)
              </label>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Base URL</label>
                <input
                  type="text"
                  value={settings.baseUrl}
                  onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">模型名称</label>
                <input
                  type="text"
                  value={settings.modelName}
                  onChange={(e) => setSettings({ ...settings, modelName: e.target.value })}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1 mt-2">图片解析方式</label>
              <select
                value={settings.ocrMode || 'local'}
                onChange={(e) =>
                  setSettings({ ...settings, ocrMode: e.target.value as 'local' | 'cloud' })
                }
                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="local">本地 OCR (纯文本模型推荐)</option>
                <option value="cloud">云端多模态 (图片直接发给模型)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2 text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
