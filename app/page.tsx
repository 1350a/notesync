import AppHeader from '@/components/layout/AppHeader';
import SettingsModalHost from '@/components/settings/SettingsModalHost';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { Fragment } from 'react';
import Reveal from './_components/Reveal';

// 首屏加载入场：纯 CSS 动画（首帧即 from 态，无闪跳），交错用 animationDelay
const HERO_ENTER =
  'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-backwards motion-safe:duration-700';

// badge 与特性条只写已实装事实：无账号体系、对话与设置存本机（doc/product-vision.md、doc/safety-protocol.md）
const BADGE = '本地优先 · 无需账号 · 对话仅存本机';
const FEATURES = ['单题对话', '整卷批量', '本地识别', '本地检索'];

// 能力卡文案只写已实装能力（对照 doc/product-vision.md §2 与总账状态列）；
// /ocr 与 /local 现状是浏览器内能力演示页，措辞标明「演示」（Wiring Honesty）。
const CAPABILITIES = [
  {
    href: '/chat',
    title: '对话诊断：错因优先于答案',
    desc: '先定位你「为什么错」，再按需给出分级提示；答案只在你主动索取时出现，绝不整段复述解法。',
    linkText: '进入单题诊断',
  },
  {
    href: '/diagnose',
    title: '整卷批量：一张卷一份报告',
    desc: '上传整卷自动切题，按错因聚类共享诊断，输出逐题诊断与汇总报告，20 题的模型调用压到个位数。',
    linkText: '进入整卷上传',
  },
  {
    href: '/ocr',
    title: '本地识别：原图不出设备',
    desc: '图片默认在浏览器内完成本地识别，仅发送文字；需要原图理解时显式切换多模态档，外发当次明示。',
    linkText: '查看本地识别演示',
  },
  {
    href: '/local',
    title: '本地检索：向量化在浏览器',
    desc: '题目文本在浏览器内完成向量化与相似检索，历史错题可被本地召回；演示页可逐环节自检。',
    linkText: '查看本地检索演示',
  },
];

const STEPS = [
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
];

// 理念条目：全部对应已实装机制（doc/product-vision.md、doc/safety-protocol.md）
const PRINCIPLES = [
  {
    title: '错因优先',
    desc: '首要输出是「为什么错」而不是答案——这是与拍照搜题产品的分界线。',
  },
  {
    title: '提示分级',
    desc: '定位 → 方向 → 关键步骤三级阶梯；你不主动要，绝不降级代答。',
  },
  {
    title: '本地优先',
    desc: '无账号体系，对话与设置仅存本机；图片默认本地识别，外发当次明示。',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* 首页专属弥散光背景（fixed 整页壁纸，内容从其上滚过）：主题色光斑缓慢漂移 +
          淡网格，避免满屏单色；色值走语义变量四主题自适应，reduced-motion 时静止为纯渐变 */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="home-grid absolute inset-0" />
        <div
          className="home-blob absolute -top-44 -left-36 h-[36rem] w-[36rem] rounded-full bg-primary/20 blur-[100px] max-sm:h-[22rem] max-sm:w-[22rem]"
          style={{ animationDuration: '38s' }}
        />
        <div
          className="home-blob absolute top-1/4 -right-44 h-[32rem] w-[32rem] rounded-full bg-accent/25 blur-[100px] max-sm:h-[20rem] max-sm:w-[20rem]"
          style={{ animationDuration: '46s', animationDelay: '-18s' }}
        />
        <div
          className="home-blob absolute -bottom-52 left-1/5 h-[34rem] w-[34rem] rounded-full bg-secondary/40 blur-[110px] max-sm:h-[22rem] max-sm:w-[22rem]"
          style={{ animationDuration: '42s', animationDelay: '-30s' }}
        />
      </div>
      {/* 首页无侧栏、无会话语境：顶栏只留 Logo 与 ⚙️（不实装的控制必须隐藏，AGENTS §8） */}
      <AppHeader showSidebarToggle={false} showNewChat={false} />
      {/* 首页不经过 AppLayout，需自带设置弹窗宿主，顶栏 ⚙️ 才能一次点击打开（doc/mobile-ux.md §7） */}
      <SettingsModalHost />

      <main className="flex-1">
        {/* 首屏：badge + 渐变大标题 + 现文案两行副标 + 光晕 CTA + 底部特性条；减去 sticky 顶栏 3.5rem 一屏放下 */}
        <section className="relative flex min-h-[calc(100svh-3.5rem)] flex-col items-center justify-center px-6 pb-24 pt-16 text-center">
          <p
            className={`${HERO_ENTER} inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-4 py-1.5 text-xs text-muted-foreground sm:text-sm`}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
            {BADGE}
          </p>
          <h1
            className={`${HERO_ENTER} mt-8 bg-gradient-to-r from-foreground via-primary/80 to-primary bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl md:text-7xl`}
            style={{ animationDelay: '100ms' }}
          >
            错题认知诊断引擎
          </h1>
          <p
            className={`${HERO_ENTER} mt-6 text-lg font-medium sm:text-xl`}
            style={{ animationDelay: '200ms' }}
          >
            让每一道错题都物尽其用
          </p>
          <p
            className={`${HERO_ENTER} mt-2 max-w-2xl text-base/relaxed text-muted-foreground`}
            style={{ animationDelay: '280ms' }}
          >
            先定位你为什么错，再按需给出分级提示。
          </p>
          <div
            className={`${HERO_ENTER} mt-10 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:gap-4`}
            style={{ animationDelay: '360ms' }}
          >
            <Link href="/chat" className="w-full sm:w-auto">
              <Button
                size="lg"
                className="h-12 w-full rounded-full px-9 text-base shadow-lg shadow-primary/40 sm:h-14 sm:w-auto sm:px-12 sm:text-lg"
              >
                开始对话诊断 →
              </Button>
            </Link>
            <Link href="/diagnose" className="w-full sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full rounded-full px-9 text-base sm:h-14 sm:w-auto sm:px-12 sm:text-lg"
              >
                批量上传
              </Button>
            </Link>
          </div>
          {/* 底部特性条：替代旧版箭头提示，暗示下方还有内容 */}
          <div
            className={`${HERO_ENTER} absolute inset-x-0 bottom-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-6 text-xs text-muted-foreground sm:text-sm`}
            style={{ animationDelay: '480ms' }}
          >
            {FEATURES.map((feature, i) => (
              <Fragment key={feature}>
                {i > 0 && <span aria-hidden className="text-border">·</span>}
                <span>{feature}</span>
              </Fragment>
            ))}
          </div>
        </section>

        {/* 能力总览：分段显著加高（约 1.5 屏），保证「滑到才出现」的节奏 */}
        <section className="mx-auto w-full max-w-5xl px-6 py-28 sm:py-36">
          <Reveal>
            <h2 className="text-3xl font-bold sm:text-4xl">一个引擎，四种能力</h2>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              两条诊断主线，两项浏览器内本地能力。
            </p>
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:gap-6">
            {CAPABILITIES.map((cap, i) => (
              <Reveal key={cap.href} delay={i * 90} className="h-full">
                {/* --card-spacing 调大一档，整卡内边距同步放大（Card 内部全按该变量取值） */}
                <Card
                  size="default"
                  className="h-full shadow-sm transition-transform duration-200 [--card-spacing:--spacing(6)] hover:-translate-y-1"
                >
                  <CardHeader>
                    <CardTitle className="text-lg font-semibold sm:text-xl">{cap.title}</CardTitle>
                    <CardDescription className="text-sm/relaxed sm:text-base/relaxed">
                      {cap.desc}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Link
                      href={cap.href}
                      className="text-sm font-medium text-primary hover:underline sm:text-base"
                    >
                      {cap.linkText} →
                    </Link>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        {/* 三步流程：bg-deep 全宽分段与上下段拉开节奏 */}
        <section className="bg-(--bg-deep)">
          <div className="mx-auto w-full max-w-5xl px-6 py-28 sm:py-36">
            <Reveal>
              <h2 className="text-3xl font-bold sm:text-4xl">一次诊断，三步完成</h2>
            </Reveal>
            <div className="mt-12 grid gap-5 md:grid-cols-3 lg:gap-6">
              {STEPS.map((item, i) => (
                <Reveal key={item.step} delay={i * 100} className="h-full">
                  <div className="flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-8">
                    <span className="text-5xl font-extrabold text-primary/60">{item.step}</span>
                    <h3 className="text-xl font-bold">{item.title}</h3>
                    <p className="text-sm/relaxed text-muted-foreground sm:text-base/relaxed">
                      {item.desc}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* 理念：立场宣言 + 三条底线 */}
        <section className="mx-auto w-full max-w-5xl px-6 py-28 sm:py-36">
          <Reveal>
            <h2 className="text-3xl font-bold sm:text-4xl">错因优先，本地优先</h2>
            <blockquote className="mt-8 border-l-2 border-primary/40 pl-6 text-xl font-medium sm:text-2xl">
              不替你解题，先定位你为什么会错，再按需给出分级提示。
            </blockquote>
          </Reveal>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {PRINCIPLES.map((p, i) => (
              <Reveal key={p.title} delay={i * 90}>
                <h3 className="text-lg font-semibold">{p.title}</h3>
                <p className="mt-3 text-sm/relaxed text-muted-foreground sm:text-base/relaxed">
                  {p.desc}
                </p>
              </Reveal>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <p className="text-center text-xs text-muted-foreground">
          Notesync · 对话与设置仅存于本机浏览器，无需账号 · 图片默认本地识别
        </p>
      </footer>
    </div>
  );
}
