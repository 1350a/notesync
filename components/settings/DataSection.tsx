'use client';

import { Button } from '@/components/ui/button';
import SettingsRow from './SettingsRow';
import { useSettingsStore } from '@/store/useSettingsStore';

/** 本地数据统一前缀：设置、客户端标识、历史遗留的 notesync_config 一并覆盖 */
const LOCAL_PREFIX = 'notesync';

export default function DataSection() {
  const reset = useSettingsStore((s) => s.reset);

  /** 清除本浏览器内全部 notesync 本地数据后刷新（客户端标识一并重置，不可撤销） */
  const clearAll = () => {
    if (!window.confirm('将清除本浏览器的全部本地数据（设置与客户端标识），并刷新页面。继续？')) {
      return;
    }
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(LOCAL_PREFIX)) keys.push(key);
      }
      keys.forEach((key) => window.localStorage.removeItem(key));
    } catch (err) {
      console.warn('[settings] 清除本地数据失败', err);
      return;
    }
    window.location.reload();
  };

  return (
    <div>
      <SettingsRow label="恢复默认设置" hint="主题、默认模型等全部回到默认值">
        <Button variant="outline" size="sm" onClick={reset}>
          恢复默认
        </Button>
      </SettingsRow>
      <SettingsRow
        label="清除全部本地数据"
        hint="删除本浏览器内的设置与客户端标识，操作不可撤销"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={clearAll}
          className="text-red-600 hover:text-red-700"
        >
          清除并刷新
        </Button>
      </SettingsRow>
    </div>
  );
}
