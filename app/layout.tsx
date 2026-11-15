import 'katex/dist/katex.min.css';
import { ANTI_FLASH_SCRIPT } from '@/lib/settings/anti-flash';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: '错题认知诊断引擎',
  description: '错题认知诊断引擎',
};

// 移动端键盘弹起时压缩布局视口，聊天输入区不被遮挡（doc/mobile-ux.md §6）
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      data-theme="light"
      suppressHydrationWarning
    >
      {/* dvh 而非 vh：移动浏览器动态工具栏下 100vh ≠ 可视高度（doc/mobile-ux.md §1） */}
      <body className="min-h-dvh bg-background text-foreground">
        {/* 首帧主题预设：水合前同步执行，避免暗色用户白屏闪烁（见 lib/settings/anti-flash.ts） */}
        {/* xss-scan-disable-next-line：注入内容为编译期静态常量，不含任何用户数据 */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
