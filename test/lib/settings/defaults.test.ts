import { describe, expect, it } from 'vitest';
import {
  cloneDefaults,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from '../../../lib/settings/types.ts';
import { resolveImageSendMode } from '../../../lib/ocr/image-handling.ts';

/*
 * 默认档「取消首次引导 → 改默认档」（product-vision.md §3.1、P4 约束③）。
 *
 * 契约：不弹任何首次引导，冷启即为保守档——图片默认先本地转文字，原图不出端；
 * 只有用户在设置里显式关闭「优先本地 OCR」，才允许按模型能力走原图直传。
 */
describe('默认设置：保守档（product-vision.md §3.1 / P4 约束③）', () => {
  it('DEFAULT_SETTINGS 的 ocr.preferLocal 为 true（全本地优先）', () => {
    expect(DEFAULT_SETTINGS.ocr.preferLocal).toBe(true);
  });

  it('cloneDefaults 返回隔离副本，改副本不污染默认值', () => {
    const a = cloneDefaults();
    a.ocr.preferLocal = false;
    expect(cloneDefaults().ocr.preferLocal).toBe(true);
  });

  it('缺省 / 坏值 / 非对象一律回落 true', () => {
    expect(normalizeSettings({}).ocr.preferLocal).toBe(true);
    expect(normalizeSettings(null).ocr.preferLocal).toBe(true);
    expect(normalizeSettings({ ocr: null }).ocr.preferLocal).toBe(true);
    expect(normalizeSettings({ ocr: ['local'] }).ocr.preferLocal).toBe(true);
    expect(normalizeSettings({ ocr: 'local' }).ocr.preferLocal).toBe(true);
  });

  it("'false' 字符串不得关闭默认档（防坏配置误把图片外发）", () => {
    expect(normalizeSettings({ ocr: { preferLocal: 'false' } }).ocr.preferLocal).toBe(true);
    expect(normalizeSettings({ ocr: { preferLocal: 0 } }).ocr.preferLocal).toBe(true);
  });

  it('只有显式 false 才关闭默认档', () => {
    expect(normalizeSettings({ ocr: { preferLocal: false } }).ocr.preferLocal).toBe(false);
    expect(normalizeSettings({ ocr: { preferLocal: true } }).ocr.preferLocal).toBe(true);
  });

  it('默认档下即使模型声明支持图片，也走本地识别（P4 约束③优先于模型能力）', () => {
    const preferLocal = cloneDefaults().ocr.preferLocal;
    expect(resolveImageSendMode({ acceptsImages: true }, preferLocal)).toBe('local-ocr');
    // 用户显式关闭后才按模型能力派生
    expect(resolveImageSendMode({ acceptsImages: true }, false)).toBe('direct');
    expect(resolveImageSendMode({ acceptsImages: false }, false)).toBe('local-ocr');
    expect(resolveImageSendMode(undefined, false)).toBe('local-ocr');
  });
});
