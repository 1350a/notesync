import AppLayout from '@/components/layout/AppLayout';

/**
 * (main) 路由组布局：承载 AppLayout（侧栏 + 顶栏 + 设置弹窗）。
 * 必须放在路由组而非各页面内部——页面内包裹会让布局随导航重挂载，
 * 侧栏状态恢复与路由切换收起都会被打断（doc/mobile-ux.md §2）。
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
