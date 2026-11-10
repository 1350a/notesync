'use client';

import { useEffect, useState } from 'react';

/**
 * 订阅 media query 的通用 hook。
 *
 * SSR/客户端首帧一律返回 false（按桌面/无匹配渲染），mount 后与实际值校正，
 * 保证两帧 markup 一致、无 hydration 闪烁（doc/mobile-ux.md §1）。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
