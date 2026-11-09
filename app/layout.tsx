import 'katex/dist/katex.min.css';
import { ANTI_FLASH_SCRIPT } from '@/lib/settings/anti-flash';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: '错题认知诊断引擎',
  description: '错题认知诊断引擎',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground">
        {/* 首帧主题预设：水合前同步执行，避免暗色用户白屏闪烁（见 lib/settings/anti-flash.ts） */}
        {/* xss-scan-disable-next-line：注入内容为编译期静态常量，不含任何用户数据 */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
