/*
 * lib/local/rag/gate.ts 纯函数用例
 *
 * 覆盖协议 doc/browser-local-inference.md §5.4 的查询侧阈值：
 * 边界值（阈值 -1 / 阈值 / 阈值 +1）、全空白、中英混排、代理对与换行缩进。
 * 全部为纯函数断言：无 IO、无 Worker、无浏览器 API。
 */
import { describe, expect, it } from 'vitest';
import { RAG_MIN_QUERY_CHARS, countQueryChars, shouldRetrieve } from '@/lib/local/rag/gate';

describe('countQueryChars', () => {
  it('忽略空白：空格、全角空格、换行、制表符都不计入', () => {
    expect(countQueryChars('  a b\n\tc\u3000d ')).toBe(4);
  });

  it('纯空白计 0', () => {
    expect(countQueryChars('   \n\t ')).toBe(0);
  });

  it('中文按单字符计', () => {
    expect(countQueryChars('二次函数')).toBe(4);
  });

  it('中英数字混排按字符计', () => {
    expect(countQueryChars('求 y=2x+1 的斜率')).toBe(10);
  });

  it('代理对（emoji）只算 1 个字符，不按 UTF-16 码元算 2', () => {
    expect(countQueryChars('📐')).toBe(1);
  });
});

describe('shouldRetrieve', () => {
  it('空串不检索', () => {
    expect(shouldRetrieve('')).toBe(false);
  });

  it('纯空白不检索', () => {
    expect(shouldRetrieve('   \n\t ')).toBe(false);
  });

  it('阈值减 1 不检索', () => {
    expect(shouldRetrieve('一'.repeat(RAG_MIN_QUERY_CHARS - 1))).toBe(false);
  });

  it('恰好等于阈值则检索', () => {
    expect(shouldRetrieve('一'.repeat(RAG_MIN_QUERY_CHARS))).toBe(true);
  });

  it('阈值加 1 检索', () => {
    expect(shouldRetrieve('一'.repeat(RAG_MIN_QUERY_CHARS + 1))).toBe(true);
  });

  it('字符数够但被空白填满时不检索（空白不计入）', () => {
    // 6 个有效字符 + 20 个空格：原始长度超阈值，有效字符仍不足
    expect(shouldRetrieve(`${'一'.repeat(6)}${' '.repeat(20)}`)).toBe(false);
  });

  it('真实问句命中：完整数学问题描述应当检索', () => {
    expect(shouldRetrieve('二次函数顶点坐标怎么求')).toBe(true);
  });

  it('真实短句跳过：问候不检索', () => {
    expect(shouldRetrieve('你好')).toBe(false);
    expect(shouldRetrieve('谢谢')).toBe(false);
    expect(shouldRetrieve('1+1')).toBe(false);
  });
});
