import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * 本地引擎租约（总账 §3「disposeLocalEngine() 调用方」）。
 * 引擎是模块级单例、持有 Worker 与 wasm 堆，这里只验证计数语义：
 * 最后一个使用方退出才 dispose，且释放幂等。
 */
const { disposeMock } = vi.hoisted(() => ({ disposeMock: vi.fn() }));

vi.mock('../../../lib/local/engine.ts', () => ({
  disposeLocalEngine: disposeMock,
}));

const { acquireLocalEngine, activeLocalEngineLeases } = await import(
  '../../../lib/local/engine-lease.ts'
);

afterEach(() => {
  disposeMock.mockClear();
  // 兜底归还，避免用例之间共享模块级计数
  while (activeLocalEngineLeases() > 0) acquireLocalEngine()();
});

describe('本地引擎租约', () => {
  it('最后一个使用方退出才释放引擎', () => {
    const releaseA = acquireLocalEngine();
    const releaseB = acquireLocalEngine();
    expect(activeLocalEngineLeases()).toBe(2);

    releaseA();
    expect(activeLocalEngineLeases()).toBe(1);
    expect(disposeMock).not.toHaveBeenCalled();

    releaseB();
    expect(activeLocalEngineLeases()).toBe(0);
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it('释放函数幂等：重复调用不把计数减成负数、不重复释放', () => {
    const release = acquireLocalEngine();
    release();
    release();
    release();
    expect(activeLocalEngineLeases()).toBe(0);
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it('释放后可重新申请，新租约独立计数', () => {
    acquireLocalEngine()();
    expect(disposeMock).toHaveBeenCalledTimes(1);

    const release = acquireLocalEngine();
    expect(activeLocalEngineLeases()).toBe(1);
    release();
    expect(disposeMock).toHaveBeenCalledTimes(2);
  });
});
