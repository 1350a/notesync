/**
 * 朗读分段（doc/tts.md §4）：按句切分 + 贪心聚合。段数尽量少——每段一次上游
 * 请求、段间有停顿；单句超限时按子句二次切，仍超限按硬切兜底（保证不产生
 * 超上游单段上限的请求）。纯函数，供 vitest 与 smoke 直测。
 */

/** 清洗后总长防呆上限（doc/tts.md §4）：正常回复几百到两千字，20000 字符
 * ≈ 一整份卷面解析，多半是误触，拦下并引导（整卷朗读入口挂账 doc/tts.md §8） */
export const MAX_SPEECH_TOTAL_CHARS = 20_000;
/** 段数防呆上限：与总上限共同构成 413 text_too_long 的两个条件 */
export const MAX_SPEECH_SEGMENTS = 20;

/** 句末标点（含换行）归属前句：后行断言切分不吞标点 */
const SENTENCE_BREAK = /(?<=[。！？!?；;\n])/;

/** 单句二次切分点：逗号/顿号/冒号 */
const CLAUSE_BREAK = /(?<=[，,、：:])/;

export function splitSpeechSegments(text: string, maxChars: number): string[] {
  const sentences = text.split(SENTENCE_BREAK).map((s) => s.trim()).filter(Boolean);
  const segments: string[] = [];
  let current = '';
  const flush = () => {
    if (current) segments.push(current);
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flush();
      segments.push(...splitLongSentence(sentence, maxChars));
    } else if (current.length + sentence.length > maxChars) {
      flush();
      current = sentence;
    } else {
      current += sentence;
    }
  }
  flush();
  return segments;
}

/** 单句超限的二次切分：先按子句聚合，无标点长串再按 maxChars 硬切 */
function splitLongSentence(sentence: string, maxChars: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const piece of sentence.split(CLAUSE_BREAK)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxChars) {
      if (current) {
        out.push(current);
        current = '';
      }
      for (let i = 0; i < trimmed.length; i += maxChars) {
        out.push(trimmed.slice(i, i + maxChars));
      }
    } else if (current.length + trimmed.length > maxChars) {
      out.push(current);
      current = trimmed;
    } else {
      current += trimmed;
    }
  }
  if (current) out.push(current);
  return out;
}
