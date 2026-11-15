import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from 'cn';

export const metadata: Metadata = {
  title: '页面不存在',
};

/**
 * 根级 404 兜底：既渲染 notFound() 调用，也兜住全应用未匹配的 URL。
 * 渲染在根布局内，天然具备全局样式、字体与主题，无需自带文档结构。
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-4xl font-bold text-muted-foreground/40">404</p>
      <h2 className="text-lg font-semibold text-foreground">页面不存在</h2>
      <p className="max-w-md text-sm text-muted-foreground">访问的地址不存在或已被移动。</p>
      <div className="mt-2 flex items-center gap-2">
        <Link href="/" className={cn(buttonVariants())}>
          返回首页
        </Link>
        <Link href="/chat" className={cn(buttonVariants({ variant: 'outline' }))}>
          去对话诊断
        </Link>
      </div>
    </div>
  );
}
