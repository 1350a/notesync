import { describe, expect, it } from 'vitest';
import {
  MAX_SPEECH_SEGMENTS,
  MAX_SPEECH_TOTAL_CHARS,
  splitSpeechSegments,
} from '../../../lib/tts/segments.ts';

/*
 * 朗读分段（doc/tts.md §4）：句切 + 贪心聚合（段数尽量少），单句超限二次切，
 * 仍超限硬切兜底——保证任何段都不超引擎单段上限。
 */
describe('splitSpeechSegments：句切与贪心聚合', () => {
  it('按句末标点切分且标点归属前句；短句聚合为一段（段数尽量少）', () => {
    expect(splitSpeechSegments('第一句。第二句！第三句？', 100)).toEqual(['第一句。第二句！第三句？']);
  });

  it('超过上限时在句界处拆段，不吞标点', () => {
    expect(splitSpeechSegments('甲句。乙句。', 4)).toEqual(['甲句。', '乙句。']);
  });

  it('换行也是句界（清洗后空行已合并）', () => {
    expect(splitSpeechSegments('第一段\n第二段', 5)).toEqual(['第一段', '第二段']);
  });
});

describe('splitSpeechSegments：超长单句的兜底', () => {
  it('单句超限按子句（逗号/顿号）二次切', () => {
    const segments = splitSpeechSegments('AAA，BBB，CCC', 5);
    expect(segments).toEqual(['AAA，', 'BBB，', 'CCC']);
  });

  it('无标点长串按 maxChars 硬切，任何段都不超上限', () => {
    const text = '啊'.repeat(2500);
    const segments = splitSpeechSegments(text, 1000);
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(1000);
    }
    expect(segments.join('')).toBe(text);
  });

  it('切分无损：句界拆与硬切组合后内容拼接还原', () => {
    const text = '开头一句。' + '中途无标点'.repeat(300) + '。结尾一句！';
    const segments = splitSpeechSegments(text, 800);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(800);
    }
    expect(segments.join('')).toBe(text);
  });
});

describe('splitSpeechSegments：边界', () => {
  it('空文本与纯空白返回空数组', () => {
    expect(splitSpeechSegments('', 1000)).toEqual([]);
    expect(splitSpeechSegments('  \n  ', 1000)).toEqual([]);
  });

  it('防呆上限常量与协议一致（doc/tts.md §4）', () => {
    expect(MAX_SPEECH_TOTAL_CHARS).toBe(20_000);
    expect(MAX_SPEECH_SEGMENTS).toBe(20);
  });
});
