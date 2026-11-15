'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from 'cn';

/**
 * 路由级错误兜底（Next 16 error 约定）。
 *
 * 只放根级一份：根 error 边界包住根布局之下的全部路由段（含 (main) 等路由组
 * 布局），一条边界即可保证「渲染异常永不白屏」；各页面再细分兜底的收益低，
 * 异常路径本身罕见。根布局自身的错误落到 global-error.tsx，二者分工见其文件头。
 *
 * Next 16 口径：props 为 { error: unknown, retry }——retry 在 16.3 转正，会重取
 * 并重渲染边界子树；error 可能不是 Error 实例（客户端抛出的原值原样透传），
 * 读 message/digest 前必须 instanceof 收窄。
 */
// 组件名不能用 Error：函数声明会遮蔽全局 Error，函数体内的
// `error instanceof Error` 会拿组件自身做比对而恒为 false
export default function ErrorFallback({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // 完整细节只进控制台（服务端错误在生产环境只有 digest，可与日志对账），不渲染给用户
    console.error(error);
  }, [error]);

  // digest 是 Next 运行时附加属性，标准 Error 类型上不存在，用 in 收窄探测
  const digest =
    error instanceof Error && 'digest' in error && typeof error.digest === 'string'
      ? error.digest
      : undefined;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-semibold text-foreground">页面出了点问题</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        渲染过程出现异常，本地保存的数据不受影响。可先重试；若反复出现，请刷新或返回首页。
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button onClick={() => retry()}>重试</Button>
        <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
          返回首页
        </Link>
      </div>
      {digest ? <p className="mt-4 text-xs text-muted-foreground/70">错误标识：{digest}</p> : null}
    </div>
  );
}
