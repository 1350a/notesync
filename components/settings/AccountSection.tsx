'use client';

/** 账号管理：项目无账号体系（doc/user-settings.md §5），仅做事实说明，不放假控件 */
export default function AccountSection() {
  return (
    <div className="space-y-3 py-2 text-sm leading-relaxed">
      <p className="font-medium text-foreground">本项目暂无账号体系。</p>
      <p className="text-muted-foreground">
        所有配置仅保存在当前浏览器（localStorage），不与任何账号绑定、不上传服务端。
        更换浏览器、设备或清除站点数据后，设置会回到默认值。
      </p>
    </div>
  );
}
