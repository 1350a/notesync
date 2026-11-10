/*
 * lib/local/assets.ts 资产清单校验用例
 *
 * checkLocalAssets 是「能力是否真就绪」的唯一判据（协议 §3：不允许假可用）。
 * 资产路径表为模块私有常量，这里通过 stub 全局 fetch 反推清单：既能断言探测口径
 * （HEAD + no-store）与就绪判定，也能在清单被改动时立刻暴露（条数与关键项断言）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLocalAssets } from '@/lib/local/assets';

/** 清单条数：与 scripts/copy-local-models.mjs 的产出一一对应 */
const ASSET_COUNT = 13;

interface FetchCall {
  url: string;
  method: string | undefined;
  cache: string | undefined;
}

/** 用给定的响应策略替换全局 fetch，并记录调用参数 */
function stubFetch(handler: (url: string) => Promise<Response> | Response): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method,
        cache: init?.cache,
      });
      return handler(String(input));
    }),
  );
  return calls;
}

const okResponse = () => new Response(null, { status: 200 });
const notFound = () => new Response(null, { status: 404 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkLocalAssets', () => {
  it('全部资产可达时就绪且无缺失项', async () => {
    stubFetch(okResponse);
    await expect(checkLocalAssets()).resolves.toEqual({ ready: true, missing: [] });
  });

  it('按 HEAD + no-store 探测（不做缓存假设）', async () => {
    const calls = stubFetch(okResponse);
    await checkLocalAssets();
    expect(calls.length).toBe(ASSET_COUNT);
    for (const call of calls) {
      expect(call.method).toBe('HEAD');
      expect(call.cache).toBe('no-store');
    }
  });

  it('清单覆盖模型权重、tokenizer 与 ORT 各档 wasm', async () => {
    const calls = stubFetch(okResponse);
    await checkLocalAssets();
    const urls = calls.map((call) => call.url);
    expect(urls).toContain('/models/bge-small-zh-v1.5/config.json');
    expect(urls).toContain('/models/bge-small-zh-v1.5/tokenizer.json');
    expect(urls).toContain('/models/bge-small-zh-v1.5/onnx/model_quantized.onnx');
    expect(urls).toContain('/models/bge-small-zh-v1.5/onnx/model_quantized.onnx_data');
    expect(urls).toContain('/models/bge-small-zh-v1.5/onnx/model_q4f16.onnx');
    expect(urls).toContain('/models/bge-small-zh-v1.5/onnx/model_q4f16.onnx_data');
    expect(urls).toContain('/models/ort/ort-wasm-simd-threaded.wasm');
    expect(urls).toContain('/models/ort/ort-wasm-simd-threaded.mjs');
    expect(urls).toContain('/models/ort/ort-wasm-simd-threaded.jsep.wasm');
    expect(urls).toContain('/models/ort/ort-wasm-simd-threaded.jsep.mjs');
    expect(urls).toContain('/models/ort/ort-wasm-simd-threaded.asyncify.wasm');
    expect(urls).toContain('/models/ort/ort-wasm-simd-threaded.asyncify.mjs');
    // 清单内无重复项
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('单个资产 404 时未就绪并精确报出缺失路径', async () => {
    const broken = '/models/ort/ort-wasm-simd-threaded.asyncify.mjs';
    stubFetch((url) => (url === broken ? notFound() : okResponse()));
    const status = await checkLocalAssets();
    expect(status.ready).toBe(false);
    expect(status.missing).toEqual([broken]);
  });

  it('多个资产缺失时全部列出', async () => {
    const brokenPrefix = '/models/bge-small-zh-v1.5/onnx/model_q4f16';
    stubFetch((url) => (url.startsWith(brokenPrefix) ? notFound() : okResponse()));
    const status = await checkLocalAssets();
    expect(status.ready).toBe(false);
    expect(status.missing).toHaveLength(2);
    for (const url of status.missing) expect(url.startsWith(brokenPrefix)).toBe(true);
  });

  it('网络异常（fetch reject）计为缺失而非抛出', async () => {
    stubFetch(() => Promise.reject(new Error('Failed to fetch')));
    const status = await checkLocalAssets();
    expect(status.ready).toBe(false);
    expect(status.missing).toHaveLength(ASSET_COUNT);
  });

  it('非 2xx（如 500）计为缺失', async () => {
    stubFetch(() => new Response(null, { status: 500 }));
    const status = await checkLocalAssets();
    expect(status.ready).toBe(false);
    expect(status.missing).toHaveLength(ASSET_COUNT);
  });
});
