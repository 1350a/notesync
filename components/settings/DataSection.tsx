'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { resetUserId, USER_ID_STORAGE_KEY } from '@/lib/client-id';
import { downloadTraces, loadTraces } from '@/lib/chat/trace';
import { getHistoryStorage } from '@/lib/history/storage';
import SettingsRow from './SettingsRow';
import { useSettingsStore } from '@/store/useSettingsStore';

/** 本地数据统一前缀：设置、客户端标识、历史遗留的 notesync_config 一并覆盖 */
const LOCAL_PREFIX = 'notesync';

export default function DataSection() {
  const reset = useSettingsStore((s) => s.reset);
  // 重置后的新标识只展示尾段，完整值不出设置页（避免被整段复制外传）
  const [newUserId, setNewUserId] = useState('');
  // trace 条数只在点开设置时读取一次（纯调试信息，不必响应式）
  const [traceCount] = useState(() => loadTraces().length);

  /** 重置上游终端用户标识（doc/user-settings.md §4.1，合规可撤销要求） */
  const resetDeviceId = () => {
    if (!window.confirm('将更换发送给模型服务商的匿名设备标识，此前标识即失效。继续？')) {
      return;
    }
    const generated = resetUserId();
    setNewUserId(generated.slice(-8));
  };

  /** 清除本浏览器内全部 notesync 本地数据（设置、客户端标识、对话历史）后刷新，不可撤销 */
  const clearAll = async () => {
    if (
      !window.confirm(
        '将清除本浏览器的全部本地数据（设置、客户端标识与对话历史），并刷新页面。继续？'
      )
    ) {
      return;
    }
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(LOCAL_PREFIX)) keys.push(key);
      }
      keys.forEach((key) => window.localStorage.removeItem(key));
      // 对话历史存在 IndexedDB，清 localStorage 清不到；降级实现下是空操作，不抛错
      await getHistoryStorage().clearAll();
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
        label="重置设备标识"
        hint={`更换发送给模型服务商的匿名标识（${USER_ID_STORAGE_KEY}），此前标识即失效`}
      >
        <div className="flex items-center gap-2">
          {newUserId && (
            <span className="text-[11px] text-muted-foreground">新标识尾段 …{newUserId}</span>
          )}
          <Button variant="outline" size="sm" onClick={resetDeviceId}>
            重置
          </Button>
        </div>
      </SettingsRow>
      <SettingsRow
        label="导出调试日志"
        hint={`最近 ${traceCount} 次请求的 SSE 事件时间线（本地 trace），排障用`}
      >
        <Button variant="outline" size="sm" onClick={downloadTraces} disabled={traceCount === 0}>
          导出 JSON
        </Button>
      </SettingsRow>
      <SettingsRow
        label="清除全部本地数据"
        hint="删除本浏览器内的设置、客户端标识与对话历史，操作不可撤销"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => void clearAll()}
          className="text-red-600 hover:text-red-700"
        >
          清除并刷新
        </Button>
      </SettingsRow>
    </div>
  );
}
