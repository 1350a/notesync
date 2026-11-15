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
  it('取 12（投喂上限 3 倍余量），显著宽于投喂上限 4 张', () => {
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

describe('标签多值解析（2026-11-15）', () => {
  it('categories 数组多值：顺序保留、去重后出参', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [item] = parseAttachments([
      { name: 'p.pdf', categories: ['wrong', 'correct', 'wrong'], text: '答案与订正' },
    ]);
    expect(item.categories).toEqual(['wrong', 'correct']);
    // 旧字段同步取主标签，供仍按单值读的下游使用
    expect(item.category).toBe('wrong');
  });

  it('数组内非法标签只剔除该项，附件本体保留', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [item] = parseAttachments([
      { name: 'p.pdf', categories: ['analysis', 'bad'], text: '正文' },
    ]);
    expect(item.categories).toEqual(['analysis']);
    expect(item.name).toBe('p.pdf');
  });

  it('标签全部非法 → 整条附件丢弃并告警带上文件名', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = parseAttachments([{ name: 'p.pdf', categories: ['x', 'y'], text: '正文' }]);
    expect(out).toEqual([]);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes('p.pdf') && m.includes('标签'))).toBe(true);
  });

  it('未传标签 → 兜底 origin（前端允许不打标签，不得因此整批失败）', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [item] = parseAttachments([{ name: 'p.pdf', text: '正文' }]);
    expect(item.categories).toEqual(['origin']);
    expect(item.category).toBe('origin');
  });

  it('旧客户端只发单值 category → 原样包成单元素数组', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [item] = parseAttachments([{ name: 'p.pdf', category: 'correct', text: '正文' }]);
    expect(item.categories).toEqual(['correct']);
    expect(item.category).toBe('correct');
  });

  it('categories 非数组（旧形态字符串）也能按单值接住', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [item] = parseAttachments([{ name: 'p.pdf', categories: 'wrong', text: '正文' }]);
    expect(item.categories).toEqual(['wrong']);
  });

  it('标签多值不影响条数上限：一个文件打满四类仍只算 1 条', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const items = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => ({
      name: `p${i}.pdf`,
      categories: ['origin', 'wrong', 'correct', 'analysis'],
      text: `第 ${i} 份`,
    }));
    expect(parseAttachments(items)).toHaveLength(MAX_ATTACHMENTS);
  });
});

describe('ocrEngine 字段透传', () => {
  const base = { name: 'img.png', category: 'origin', text: 'OCR 产物文本' };

  it('local / cloud 原样透出', () => {
    const [local] = parseAttachments([{ ...base, ocrEngine: 'local' }]);
    expect(local.ocrEngine).toBe('local');
    const [cloud] = parseAttachments([{ ...base, ocrEngine: 'cloud' }]);
    expect(cloud.ocrEngine).toBe('cloud');
  });

  it('非法值丢弃该字段，附件本体保留（缺省走中性「OCR」标签）', () => {
    const [bad1] = parseAttachments([{ ...base, ocrEngine: 'zhipu' }]);
    expect(bad1.ocrEngine).toBeUndefined();
    expect(bad1.name).toBe('img.png');
    const [bad2] = parseAttachments([{ ...base, ocrEngine: null }]);
    expect(bad2.ocrEngine).toBeUndefined();
  });

  it('缺省不写字段', () => {
    const [item] = parseAttachments([base]);
    expect(item.ocrEngine).toBeUndefined();
  });
});
