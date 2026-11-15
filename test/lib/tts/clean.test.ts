import { describe, expect, it } from 'vitest';
import { cleanSpeechText } from '../../../lib/tts/clean.ts';

/*
 * 朗读清洗规则（doc/tts.md §3）：markdown 源 → 可听纯文本。
 * 顺序即实现顺序；逐规则锁定，防后续改清洗时读出标记符号或丢失语义。
 */
describe('cleanSpeechText：代码块与公式', () => {
  it('围栏代码块整块删除（朗读代码无意义且极费字符）', () => {
    const cleaned = cleanSpeechText('先看结论。\n```py\nprint("secret_url")\n```\n以上。');
    expect(cleaned).toBe('先看结论。\n以上。');
  });

  it('块级公式 $$…$$ 删除，行内公式 $…$ 去定界符保留原文', () => {
    const cleaned = cleanSpeechText('能量守恒：\n$$E=mc^2$$\n即 $E=mc^2$ 成立。');
    expect(cleaned).toContain('即 E=mc^2 成立');
    expect(cleaned).not.toContain('$$');
    expect(cleaned).not.toContain('能量守恒：\n\n即');
  });

  it('整条消息只有代码块 → 清洗后为空（empty_text 的判定基础）', () => {
    expect(cleanSpeechText('```\nx=1\n```')).toBe('');
  });
});

describe('cleanSpeechText：链接与图片', () => {
  it('链接保留显示文本，图片删除，裸 URL 删除（行内删除留空格防粘字）', () => {
    const cleaned = cleanSpeechText(
      '详见[官方文档](https://example.com/a?b=1)与![截图](https://img.example.com/x.png)，访问 https://plain.example.com 查看。',
    );
    expect(cleaned).toBe('详见官方文档与 ，访问 查看。');
    expect(cleaned).not.toContain('https://');
    expect(cleaned).not.toContain('截图');
  });
});

describe('cleanSpeechText：标记去壳', () => {
  it('标题/加粗/斜体/引用/行内代码/列表标记去壳留文字', () => {
    const cleaned = cleanSpeechText(
      '## 第一步\n\n**注意** *斜体* 和 `x=1` 的用法：\n\n- 要点甲\n- 要点乙\n\n> 引用原话',
    );
    expect(cleaned).toBe('第一步\n注意 斜体 和 x=1 的用法：\n要点甲\n要点乙\n引用原话');
  });

  it('有序列表数字保留（是内容），snake_case 下划线不被拆', () => {
    const cleaned = cleanSpeechText('1. 先做 file_name 检查\n2. 再做后处理');
    expect(cleaned).toContain('1. 先做 file_name 检查');
    expect(cleaned).not.toContain('file name');
  });

  it('删除线与水平线处理', () => {
    const cleaned = cleanSpeechText('~~过时做法~~\n\n---\n\n新做法');
    expect(cleaned).not.toContain('~~');
    expect(cleaned).not.toContain('---');
    expect(cleaned).toContain('新做法');
  });
});

describe('cleanSpeechText：表格与空白', () => {
  it('表格分隔行丢弃、数据行单元格以「，」连接', () => {
    const cleaned = cleanSpeechText('| 方法 | 优劣 |\n| --- | --- |\n| 直传 | 快 |\n| 转写 | 稳 |');
    expect(cleaned).toBe('方法，优劣\n直传，快\n转写，稳');
  });

  it('HTML 标签剥壳、连续空白与空行压缩（标签位置留空格防粘字）', () => {
    const cleaned = cleanSpeechText('<b>加粗</b>文字\n\n\n\n第二段');
    expect(cleaned).toBe('加粗 文字\n第二段');
  });
});
