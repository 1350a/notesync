'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * 订阅 media query 的通用 hook。
 *
 * 用 useSyncExternalStore 而非 effect + setState：media query 是外部可订阅源，
 * 快照式读取天然避免级联渲染。getServerSnapshot 恒返回 false——SSR/客户端首帧
 * 一致（按桌面/无匹配渲染），mount 后随实际值校正，无 hydration 闪烁。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
