/*
 * 本地推理引擎租约（引用计数）——总账 §3「`disposeLocalEngine()` 调用方」
 *
 * 背景：引擎是模块级单例，持有 Worker 与 wasm 堆，不释放会随页面停留一直常驻。
 * 但直接在某处卸载时 dispose 又会误伤其它使用方，所以统一用租约：
 *   - 使用方（`hooks/useLocalEngine.ts` 的能力页与设置分区、
 *     `hooks/useChat.ts` 的本地检索链路）挂载时 acquire，卸载时调用返回的释放函数；
 *   - 引用计数归零才真正 terminate（dispose 内部让出宏任务，
 *     保证重新挂载时旧 Worker 的迟到消息不串入新单例）；
 *   - 释放函数幂等，重复调用不会把计数减成负数。
 *
 * 约定：本模块只做计数，不做初始化——初始化仍由 `initLocalEngine` /
 * `embedTexts` 按需触发，避免"只是打开页面"就下载模型。
 */
import { disposeLocalEngine } from './engine';

let leases = 0;

/** 申请一次使用租约；返回的释放函数幂等 */
export function acquireLocalEngine(): () => void {
  leases += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    leases -= 1;
    if (leases === 0) void disposeLocalEngine();
  };
}

/** 当前活跃租约数（自检/测试用） */
export function activeLocalEngineLeases(): number {
  return leases;
}
