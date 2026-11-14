import { describe, expect, it } from 'vitest';
import {
  cloneDefaults,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from '../../../lib/settings/types.ts';
import { resolveImageSendMode } from '../../../lib/ocr/image-handling.ts';

/*
 * OCR 引擎默认档（doc/cloud-ocr.md §4，2026-11-14 拍板改云端）。
 *
 * 契约：engine 缺省 / 坏值 / 非对象一律回落 'cloud'（质量优先）；旧存量的
 * preferLocal 键按未知字段丢弃（要不要转写已改为按模型能力自动路由，
 * product-vision.md P4，不再有档位偏好字段）。
 */
describe('OCR 引擎偏好：默认云端（doc/cloud-ocr.md §4）', () => {
  it('DEFAULT_SETTINGS 的 ocr.engine 为 cloud（2026-11-14 拍板）', () => {
    expect(DEFAULT_SETTINGS.ocr.engine).toBe('cloud');
  });

  it('cloneDefaults 返回隔离副本，改副本不污染默认值', () => {
    const a = cloneDefaults();
    a.ocr.engine = 'local';
    expect(cloneDefaults().ocr.engine).toBe('cloud');
  });

  it('缺省 / 坏值 / 非对象一律回落 cloud（旧存储无 engine 字段同此路径）', () => {
    expect(normalizeSettings({}).ocr.engine).toBe('cloud');
    expect(normalizeSettings(null).ocr.engine).toBe('cloud');
    expect(normalizeSettings({ ocr: null }).ocr.engine).toBe('cloud');
    expect(normalizeSettings({ ocr: { engine: 'remote' } }).ocr.engine).toBe('cloud');
    expect(normalizeSettings({ ocr: { engine: 1 } }).ocr.engine).toBe('cloud');
    expect(normalizeSettings({ ocr: 'local' }).ocr.engine).toBe('cloud');
  });

  it('显式 local 生效；旧存量 preferLocal 键按未知字段丢弃、不影响 engine', () => {
    expect(normalizeSettings({ ocr: { engine: 'local' } }).ocr.engine).toBe('local');
    expect(
      normalizeSettings({ ocr: { preferLocal: true, engine: 'local' } }).ocr
    ).toEqual({ engine: 'local' });
    expect(
      normalizeSettings({ ocr: { preferLocal: false, engine: 'cloud' } }).ocr
    ).toEqual({ engine: 'cloud' });
  });
});

/*
 * 图片路径自动路由（product-vision.md P4，2026-11-14）：只看模型能力，无人工档位。
 * 多模态直传原图（无转写）；纯文本 / 能力未知保守转文字（绝不赌上游）。
 */
describe('图片路径派生：只看模型能力（product-vision.md P4）', () => {
  it('acceptsImages=true → direct（多模态直传，无转写）', () => {
    expect(resolveImageSendMode({ acceptsImages: true })).toBe('direct');
  });

  it('acceptsImages=false → ocr-text（纯文本模型走转写）', () => {
    expect(resolveImageSendMode({ acceptsImages: false })).toBe('ocr-text');
  });

  it('能力未知 / 无模型 → ocr-text（保守转文字，绝不赌上游）', () => {
    expect(resolveImageSendMode({ acceptsImages: undefined })).toBe('ocr-text');
    expect(resolveImageSendMode({})).toBe('ocr-text');
    expect(resolveImageSendMode(undefined)).toBe('ocr-text');
  });
});
