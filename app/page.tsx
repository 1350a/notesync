import AppHeader from '@/components/layout/AppHeader';
import SettingsModalHost from '@/components/settings/SettingsModalHost';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader />
      {/* 首页不经过 AppLayout，需自带设置弹窗宿主，顶栏 ⚙️ 才能一次点击打开（doc/mobile-ux.md §7） */}
      <SettingsModalHost />

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

        {/* 三张真实卖点卡：文案只写已实装能力（对照 doc/product-vision.md §2 与总账状态列） */}
        <section className="space-y-6 pt-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>对话诊断：错因优先于答案</CardTitle>
                <CardDescription>
                  先定位你「为什么错」，再按需给出分级提示；答案只在你主动索取时出现，绝不整段复述解法。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/chat" className="text-sm font-medium text-primary hover:underline">
                  进入单题诊断 →
                </Link>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>整卷批量：一张卷一份报告</CardTitle>
                <CardDescription>
                  上传整卷自动切题，按错因聚类共享诊断，输出逐题诊断与汇总报告，20 题的模型调用压到个位数。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/diagnose" className="text-sm font-medium text-primary hover:underline">
                  进入整卷上传 →
                </Link>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>本地优先：默认原图不出设备</CardTitle>
                <CardDescription>
                  图片默认在浏览器内完成本地识别，仅发送文字；需要原图理解时显式切换多模态档，外发当次明示。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/ocr" className="text-sm font-medium text-primary hover:underline">
                  查看本地识别能力 →
                </Link>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* 流程三栏：上传 → 追问 → 报告 */}
        <section className="space-y-4 pt-4">
          <h2 className="text-2xl font-bold">一次诊断，三步完成</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: '01',
                title: '上传题目',
                desc: '拍照或上传单题、整卷，图片默认走本地识别，文字直接粘贴也行。',
              },
              {
                step: '02',
                title: '追问定位错因',
                desc: 'AI 带着可验证的推测追问，先定位断点再给分级提示，不直接代答。',
              },
              {
                step: '03',
                title: '拿到诊断报告',
                desc: '逐题给出错因与策略卡，整卷另出汇总报告；每一步依据都可解释。',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-lg border border-border bg-card p-6 flex flex-col gap-2"
              >
                <span className="text-3xl font-extrabold text-primary/60">{item.step}</span>
                <h3 className="text-lg font-bold">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
