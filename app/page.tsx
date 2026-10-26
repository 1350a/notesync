import Link from "next/link";

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-zinc-950 p-8 text-zinc-100">
      {/* 背景装饰光斑 */}
      <div className="pointer-events-none absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative z-10 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          本地 AI 驱动 · 数据不出电脑
        </div>
        <h1 className="mb-4 bg-gradient-to-r from-indigo-300 via-white to-cyan-300 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl">
          错题认知诊断引擎
        </h1>
        <p className="mb-2 text-xl text-zinc-300">
          不是简单搜题给答案
        </p>
        <p className="mb-10 text-xl text-zinc-300">
          上传/粘贴错题，定位知识薄弱点，生成个性化复习方案
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/chat"
            className="group inline-flex items-center gap-2 rounded-2xl bg-indigo-500 px-8 py-3.5 text-lg font-medium text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-400 hover:shadow-indigo-400/40"
          >
            开始对话诊断
            <svg
              className="h-5 w-5 transition-transform group-hover:translate-x-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 8l4 4m0 0l-4 4m4-4H3"
              />
            </svg>
          </Link>
          <Link
            href="/diagnose"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-3.5 text-lg text-zinc-300 transition hover:bg-white/10"
          >
            传统上传诊断
          </Link>
        </div>
      </div>

      <footer className="absolute bottom-6 text-xs text-zinc-600">
        多轮对话 · 对话分支 · 知识薄弱点定位 · 个性化复习方案
      </footer>
    </main>
  );
}
