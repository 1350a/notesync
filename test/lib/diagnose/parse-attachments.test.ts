/**
 * 请求附件校验用例（对应审查项 S3：附件条数上限）。
 *
 * 背景：单图体积（MAX_DATA_URL）此前已限，但数组长度不限——一次 POST 塞几百条附件
 * 照样能把内存与组装耗时打满，而投喂侧本来只用其中少数（doc/diagnose-file-intake.md：
 * 图片投喂上限 4 张，超出降级为文字占位）。现补 MAX_ATTACHMENTS = 12，
 * 超量截断并 console.warn 留痕，不静默丢弃。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ATTACHMENTS,
  MAX_DATA_URL,
  parseAttachments,
} from '@/lib/diagnose/parse-attachments';

/** 构造一条合法附件（走 text 分支，不携带 base64 本体） */
const textAttachment = (i: number) => ({
  name: `q${i}.png`,
  category: 'origin',
  text: `第 ${i} 题题干`,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MAX_ATTACHMENTS 常量', () => {
  it('取 12（四类标签各 3 张），显著宽于投喂上限 4 张', () => {
    expect(MAX_ATTACHMENTS).toBe(12);
    expect(MAX_ATTACHMENTS).toBeGreaterThan(4);
  });

  it('单图体积上限保持 12MB', () => {
    expect(MAX_DATA_URL).toBe(12 * 1024 * 1024);
  });
});

describe('parseAttachments 条数截断', () => {
  it('恰好达到上限时全部保留', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => textAttachment(i));
    const out = parseAttachments(raw);
    expect(out).toHaveLength(MAX_ATTACHMENTS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('超过上限时截断为上限条数，并告警说明原条数', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = Array.from({ length: 200 }, (_, i) => textAttachment(i));
    const out = parseAttachments(raw);
    expect(out).toHaveLength(MAX_ATTACHMENTS);
    // 保留的是前 MAX_ATTACHMENTS 条（顺序不变）
    expect(out[0].name).toBe('q0.png');
    expect(out[MAX_ATTACHMENTS - 1].name).toBe(`q${MAX_ATTACHMENTS - 1}.png`);

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes('200') && m.includes('上限'))).toBe(true);
  });

  it('截断发生在解析前：脏数据同样消耗名额，不会绕过上限', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 前 12 条全是非法项，后 8 条合法——按输入顺序截断，合法项一并被挡在门外
    const raw = [
      ...Array.from({ length: MAX_ATTACHMENTS }, () => ({ name: '', category: 'bad' })),
      ...Array.from({ length: 8 }, (_, i) => textAttachment(i)),
    ];
    const out = parseAttachments(raw);
    expect(out).toHaveLength(0);
  });

  it('非数组输入返回空数组（不抛错）', () => {
    expect(parseAttachments(undefined)).toEqual([]);
    expect(parseAttachments('not-an-array')).toEqual([]);
  });
});
