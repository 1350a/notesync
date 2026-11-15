/**
 * (main) 路由组加载态：包住组内各页面的 Suspense fallback。
 *
 * 侧栏与顶栏由 (main)/layout.tsx 承载，加载期间保持原状，仅内容区出骨架；
 * 容器对齐 AppLayout 的 <main className="flex-1 overflow-y-auto">，
 * 用 h-full 撑满内容区并居中。装饰性骨架对读屏无意义，整体 aria-hidden。
 */
export default function Loading() {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2"
      aria-hidden
    >
      <div className="h-2 w-40 animate-pulse rounded-full bg-muted" />
      <div className="h-2 w-56 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
      <div className="h-2 w-32 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
    </div>
  );
}
