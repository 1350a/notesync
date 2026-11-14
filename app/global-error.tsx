'use client';

import { useEffect } from 'react';
import { ANTI_FLASH_SCRIPT } from '@/lib/settings/anti-flash';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from 'cn';
import './globals.css';

/**
 * 根布局级错误兜底（Next 16 global-error 约定）。
 *
 * 与 error.tsx 的分工：error.tsx 兜根布局之下的渲染异常；根布局本身
 * （防闪烁脚本、字体加载等）抛错时才落到这里。本文件激活时会整体替换
 * 根布局，因此必须自带 <html>/<body> 并自行引入全局样式——bg-background
 * 等主题令牌来自 globals.css，不引入则永远黑字白底。
 *
 * 主题：根布局靠防闪烁脚本预设 data-theme，本文件不经过根布局，故注入
 * 同一份脚本（口径与 lib/settings/anti-flash.ts 完全一致，零复制）。
 * 字体：不引入 next/font（错误页用系统字体栈即可，官方也建议从简），
 * globals.css 里的 --font-geist-sans 变量缺失时自然回落。
 * metadata 导出在 global-error 中不受支持，标题用 React <title> 代替。
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground">
        {/* 与根布局同款防闪烁：水合前从 localStorage 读回真实主题，避免暗色用户看到白底 */}
        {/* xss-scan-disable-next-line：注入内容为编译期静态常量，不含任何用户数据 */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
        <title>出错了 - 错题认知诊断引擎</title>
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-lg font-semibold">应用出了点问题</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            应用初始化过程出现异常，本地保存的数据不受影响。可尝试重试；若反复出现，请返回首页。
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={() => retry()}>重试</Button>
            {/* 用原生 <a> 而非 next/link：根布局刚崩溃，客户端路由状态不可信，整页跳转更稳 */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 同上理由，刻意不用 Link */}
            <a href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
              返回首页
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
