// 定义设置的数据结构（从 SettingsModal 搬过来了）
export interface AppSettings {
  provider: 'deepseek' | 'zhipu' | 'custom';
  apiKey: string;
  baseUrl: string;
  modelName: string;
  ocrMode: 'local' | 'cloud';
}

// 默认的配置兜底
const DEFAULT_SETTINGS: AppSettings = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  modelName: 'deepseek-v4-flash',
  ocrMode: 'local',
};

/**
 * 获取当前生效的配置
 * 逻辑：先从浏览器 localStorage 读用户存的，如果没有，就用默认的。
 */
export function getEffectiveSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;

  const saved = localStorage.getItem('notesync_config');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // 合并默认值，防止旧版本缺少字段
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  }
  return DEFAULT_SETTINGS;
}
