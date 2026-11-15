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
  { key: 'local', icon: '💻', label: '本地能力' },
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

  // <md 铺满视口成全屏 sheet，桌面维持定高弹窗（doc/mobile-ux.md §7）
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm max-md:p-0">
      <div className="flex h-[560px] max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl max-md:h-dvh max-md:max-h-none max-md:rounded-none max-md:border-0 md:flex-row">
        {/* 窄屏标题栏：桌面端标题在左栏内，这一行仅移动端出现 */}
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3 md:hidden">
          <h2 className="text-base font-bold text-foreground">系统设置</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="关闭设置"
            aria-label="关闭设置"
          >
            ✕
          </button>
        </div>

        {/* 导航：窄屏为五项等分网格（图标在上、文字在下，首屏全可见免横滑），桌面端恢复左侧固定竖栏 */}
        <aside className="grid shrink-0 grid-cols-5 gap-1 border-b border-border/60 px-2 py-2 md:flex md:w-44 md:flex-col md:gap-1 md:border-b-0 md:border-r md:border-border/60 md:px-4 md:py-4">
          <h2 className="mb-3 hidden px-2 text-lg font-bold text-foreground md:block">系统设置</h2>
          {NAV_ITEMS.map((item) => {
            const active = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={`flex min-w-0 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-1 py-1.5 text-xs transition-colors md:flex-row md:items-center md:justify-start md:gap-2 md:px-3 md:py-2 md:text-sm ${
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
        <div className="relative min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
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
