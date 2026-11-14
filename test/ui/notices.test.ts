import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AiGeneratedNotice from '@/components/chat/AiGeneratedNotice';
import { AI_GENERATED_NOTICE } from '@/lib/ui/notices';

/**
 * AI 生成内容提示的红线用例。
 *
 * 锁死两件事：
 * 1. 文案常量本身不能退化成「内容由 AI 生成」这种只满足合规、对用户无价值的写法
 *    ——必须带「可能存在错误」与「核实」两个动作词；
 * 2. 组件渲染输出里确实有这句文案（防止有人把组件掏空成空 <p>，页面静默失去提示）。
 */
describe('AI 生成内容提示', () => {
  it('文案对用户可行动：说明 AI 生成、可能出错、需核实', () => {
    expect(AI_GENERATED_NOTICE).toContain('AI 生成');
    expect(AI_GENERATED_NOTICE).toContain('可能存在错误');
    expect(AI_GENERATED_NOTICE).toContain('核实');
    // 只写「内容由AI生成」是合规套话，不作为可接受的实现
    expect(AI_GENERATED_NOTICE.replace(/\s/g, '')).not.toBe('内容由AI生成');
  });

  it('组件渲染输出包含该文案', () => {
    const html = renderToStaticMarkup(createElement(AiGeneratedNotice));
    expect(html).toContain(AI_GENERATED_NOTICE);
    expect(html).toContain('<p');
  });
});
