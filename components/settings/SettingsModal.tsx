'use client';

import { useState } from 'react';
import AccountSection from './AccountSection';
import AgreementSection from './AgreementSection';
import DataSection from './DataSection';
import GeneralSection from './GeneralSection';
import LocalCapabilitySection from './LocalCapabilitySection';

type SettingsSection = 'general' | 'local' | 'account' | 'data' | 'agreement';

const NAV_ITEMS: { key: SettingsSection; icon: string; label: string }[] = [
  { key: 'general', icon: '⚙️', label: '通用设置' },
  { key: 'local', icon: '🧩', label: '本地能力' },
  { key: 'account', icon: '👤', label: '账号管理' },
  { key: 'data', icon: '🗃️', label: '数据管理' },
  { key: 'agreement', icon: '📄', label: '服务协议' },
];

/**
 * 侧栏式系统设置弹窗（布局参考通用系统设置：左侧固定导航 + 右侧内容区）。
 * 分区组件按需挂载：关闭即卸载，避免分区内的副作用（如 useModels 请求）空跑。
 */
export default function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>('general');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex h-[560px] max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
        {/* 左侧固定导航 */}
        <aside className="flex w-44 shrink-0 flex-col gap-1 border-r border-border/60 p-4">
          <h2 className="mb-3 px-2 text-lg font-bold text-foreground">系统设置</h2>
          {NAV_ITEMS.map((item) => {
            const active = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </aside>

        {/* 右侧内容区 */}
        <div className="relative min-w-0 flex-1 overflow-y-auto px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="关闭设置"
          >
            ✕
          </button>
          {section === 'general' && <GeneralSection />}
          {section === 'local' && <LocalCapabilitySection />}
          {section === 'account' && <AccountSection />}
          {section === 'data' && <DataSection />}
          {section === 'agreement' && <AgreementSection />}
        </div>
      </div>
    </div>
  );
}
