'use client';

/*
 * 本地推理引擎状态 hook（app/(main)/local 能力页与设置分区 LocalCapabilitySection 共用，
 * hooks/ 多组件复用约定）。
 *
 * 引擎是模块级单例、无 React 订阅机制，这里用挂载期轮询读取状态：
 * 两处调用方均为条件挂载（能力页路由、设置弹窗切到「本地能力」分区），
 * 卸载即停表，不产生常驻开销；800ms 粒度足够展示下载/编译进度。
 *
 * 释放（总账 §3 `disposeLocalEngine()` 调用方）：引擎持有 Worker 与 wasm 堆，
 * 不释放会一直常驻内存。走 `lib/local/engine-lease.ts` 的引用计数而不是「卸载即释放」——
 * 设置分区关闭时能力页可能仍挂着，直接释放会让对方下次嵌入时撞上未就绪引擎并重新编译（2–4s）。
 * 与 `hooks/useChat.ts` 的检索链路共用同一份计数，最后一个使用方卸载才 terminate。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getLocalEngineStatus,
  initLocalEngine,
  type LocalEngineStatus,
} from '@/lib/local/engine';
import { acquireLocalEngine } from '@/lib/local/engine-lease';
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
    const release = acquireLocalEngine();
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
      // 归还租约：最后一个使用方退出才真正 terminate；仍在途的 embed 由 dispose 内部 reject 收口
      release();
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
