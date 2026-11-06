import AppHeader from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12 space-y-8">
        {/* 顶部欢迎语 */}
        <section className="text-center space-y-4 py-10">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            让每一道错题都物尽其用
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            基于多模态大模型的错题认知诊断引擎。支持单题深度对话解析，以及批量试卷智能诊断。
          </p>
          <div className="flex items-center justify-center gap-4 pt-4">
            <Link href="/chat">
              <Button size="lg" className="rounded-full px-8">
                开始对话
              </Button>
            </Link>
            <Link href="/diagnose">
              <Button size="lg" variant="outline" className="rounded-full px-8">
                批量上传
              </Button>
            </Link>
          </div>
        </section>

        {/* 下方生成大量占位内容，用于测试 Header 的吸顶效果 */}
        <section className="space-y-6 pt-10">
          <h2 className="text-2xl font-bold">功能特性展示（滚动测试区）</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Array.from({ length: 10 }).map((_, i) => (
              <Card key={i} className="shadow-sm">
                <CardHeader>
                  <CardTitle>智能诊断模块 {i + 1}</CardTitle>
                  <CardDescription>
                    向下滚动页面，查看顶部导航栏是否保持吸顶并带有毛玻璃效果。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-32 bg-muted/50 rounded-lg flex items-center justify-center text-muted-foreground text-sm border border-dashed">
                    占位内容区域
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
