import { describe, expect, it } from 'vitest';
import { askUserTool, coerceOption } from '../../../lib/tools/builtin/ask_user.ts';

describe('coerceOption（选项收敛：模型实测会把选项传成对象）', () => {
  it('字符串原样通过', () => {
    expect(coerceOption('求根公式')).toBe('求根公式');
  });

  it('对象按常见键提取文本', () => {
    expect(coerceOption({ text: '讲解检索结果[1]的等比数列错题' })).toBe('讲解检索结果[1]的等比数列错题');
    expect(coerceOption({ label: '上传错题', value: '上传' })).toBe('上传错题');
    expect(coerceOption({ content: '测试助手是否在线' })).toBe('测试助手是否在线');
  });

  it('无可提取文本的对象/其他类型返回 null', () => {
    expect(coerceOption({ foo: 1 })).toBeNull();
    expect(coerceOption(42)).toBeNull();
    expect(coerceOption(null)).toBeNull();
    expect(coerceOption(['数组'])).toBeNull();
  });
});

describe('ask_user handler 容错（实测失败模式：options 传对象）', () => {
  const callHandler = async (args: Record<string, unknown>) => {
    const handler = askUserTool.handler!;
    return handler(args, {});
  };

  it('options 传对象数组：不再校验失败，收敛为字符串', async () => {
    const result = await callHandler({
      questions: [
        {
          label: '意图确认',
          question: '你发的「1」是想做什么？',
          options: [{ text: '讲解检索结果[1]的等比数列错题' }, '上传错题来诊断', { value: '测试助手是否在线' }],
        },
      ],
    });
    expect(result.kind).toBe('awaiting_user');
    if (result.kind !== 'awaiting_user') return;
    expect(result.questions[0].options).toEqual([
      '讲解检索结果[1]的等比数列错题',
      '上传错题来诊断',
      '测试助手是否在线',
    ]);
  });

  it('字符串选项与空选项混合：空项过滤，正常返回', async () => {
    const result = await callHandler({
      questions: [{ question: '选一个', options: ['A', '', '   ', { label: '' }, 'B'] }],
    });
    if (result.kind !== 'awaiting_user') throw new Error('应为 awaiting_user');
    expect(result.questions[0].options).toEqual(['A', 'B']);
  });

  it('questions 缺失/空仍拒绝（守住兜底语义）', async () => {
    await expect(callHandler({ questions: [] })).rejects.toThrow('questions 不能为空');
    await expect(callHandler({})).rejects.toThrow();
  });
});
