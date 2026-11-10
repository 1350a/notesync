'use client';

/*
 * 本地推理引擎状态 hook（设置行与 app/local 能力页共用，hooks/ 多组件复用约定）。
 *
 * 引擎是模块级单例、无 React 订阅机制，这里用挂载期轮询读取状态：
 * 设置弹窗关闭即卸载不产生常驻开销；能力页存活期间 800ms 粒度足够展示进度。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getLocalEngineStatus,
  initLocalEngine,
  type LocalEngineStatus,
} from '@/lib/local/engine';
import {
  checkLocalAssets,
  type LocalAssetStatus,
} from '@/lib/local/assets';

export function useLocalEngine() {
  const [status, setStatus] = useState<LocalEngineStatus>(() =>
    getLocalEngineStatus(),
  );
  const [assets, setAssets] = useState<LocalAssetStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkLocalAssets()
      .then((a) => {
        if (!cancelled) setAssets(a);
      })
      .catch(() => {
        if (!cancelled) setAssets({ ready: false, missing: [] });
      });
    const timer = setInterval(() => setStatus(getLocalEngineStatus()), 800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const init = useCallback(
    async (onProgress?: (progress: number) => void) => {
      const final = await initLocalEngine(onProgress);
      setStatus(final);
      return final;
    },
    [],
  );

  return { status, assets, init };
}
