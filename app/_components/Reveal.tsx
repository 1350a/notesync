'use client';

import { cn } from 'cn';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** 入场延迟（ms）：同段多卡片用它做交错 */
  delay?: number;
};

/**
 * 滚动入场包装器：SSR 默认完全可见（无 JS / 爬虫安全），hydration 后才对
 * 视口外元素做一次性 fade + 上移入场；prefers-reduced-motion 或浏览器无
 * IntersectionObserver 时不接管，内容保持可见。
 * 入场动画带 fill-mode-backwards：延迟期间保持 from 态（透明）、结束后回落
 * 基样式（可见）——tw-animate-css 的 animate-in 默认 fill-mode 为 none，
 * 不加它交错延迟会先显示再闪隐。
 */
export default function Reveal({ children, className, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  // ssr：未接管（可见）→ hidden：已接管、等入视口 → in：播放入场
  const [phase, setPhase] = useState<'ssr' | 'hidden' | 'in'>('ssr');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const inViewport = el.getBoundingClientRect().top < window.innerHeight;
    if (reduced || inViewport || !('IntersectionObserver' in window)) {
      setPhase('in');
      return;
    }
    setPhase('hidden');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPhase('in');
          io.disconnect();
        }
      },
      // rootMargin 收一成：元素露出一点再触发，入场不至于贴着屏幕底边太早
      { threshold: 0.1, rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        phase === 'hidden' && 'opacity-0',
        phase === 'in' &&
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-backwards motion-safe:duration-700',
        className,
      )}
      style={delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
