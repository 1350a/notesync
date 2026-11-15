import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ErrorFallback from '@/app/error';
import GlobalErrorFallback from '@/app/global-error';
import NotFoundPage from '@/app/not-found';
import LoadingSkeleton from '@/app/(main)/loading';
import { ANTI_FLASH_SCRIPT } from '@/lib/settings/anti-flash';

/**
 * 白屏防线四个特殊文件的渲染用例。
 *
 * 与 test/ui/notices.test.ts 同一动机：这些兜底页平时不可见，最容易在
 * 重构中被改坏却无人发现（文案掏空、丢按钮、丢文档结构），用静态渲染
 * 把关键事实锁死。不测交互（retry 行为由 Next 边界保证），只测「渲染出
 * 了该有的结构」。
 */
function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe('app/error.tsx 路由级兜底', () => {
  it('渲染标题、说明与重试/返回首页两个动作', () => {
    const html = render(
      createElement(ErrorFallback, { error: new Error('boom'), retry: () => {} }),
    );
    expect(html).toContain('页面出了点问题');
    expect(html).toContain('重试');
    expect(html).toContain('返回首页');
    // 完整错误细节不上屏（生产环境本就只有 digest），防敏感信息泄露
    expect(html).not.toContain('boom');
  });

  it('Error 带 digest 时展示错误标识，便于与服务端日志对账', () => {
    const err = Object.assign(new Error('boom'), { digest: 'abc123' });
    const html = render(createElement(ErrorFallback, { error: err, retry: () => {} }));
    // 静态渲染会在文本插值处插 <!-- --> 分隔符，分别断言前缀与值
    expect(html).toContain('错误标识');
    expect(html).toContain('abc123');
    expect(html).not.toContain('boom');
  });

  it('error 为非 Error 值（客户端原样抛出）时正常渲染且无标识行', () => {
    const html = render(createElement(ErrorFallback, { error: '字符串错误', retry: () => {} }));
    expect(html).toContain('页面出了点问题');
    expect(html).not.toContain('错误标识');
  });
});

describe('app/global-error.tsx 根级兜底', () => {
  it('自带 html/body 文档结构并注入防闪烁脚本（不经过根布局，必须自持）', () => {
    const html = render(
      createElement(GlobalErrorFallback, { error: new Error('root boom'), retry: () => {} }),
    );
    expect(html).toContain('<html');
    expect(html).toContain('<body');
    // 主题信号与根布局同源：同一份 ANTI_FLASH_SCRIPT 常量
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('notesync-settings.v1');
  });

  it('渲染标题与重试/返回首页；返回首页用原生 <a>（根布局崩溃后客户端路由不可信）', () => {
    const html = render(
      createElement(GlobalErrorFallback, { error: new Error('root boom'), retry: () => {} }),
    );
    expect(html).toContain('应用出了点问题');
    expect(html).toContain('重试');
    expect(html).toContain('<a href="/"');
  });
});

describe('app/not-found.tsx 404 兜底', () => {
  it('渲染 404 标识与两个入口链接', () => {
    const html = render(createElement(NotFoundPage));
    expect(html).toContain('404');
    expect(html).toContain('页面不存在');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/chat"');
  });
});

describe('app/(main)/loading.tsx 路由组加载态', () => {
  it('输出装饰性骨架：pulse 动画 + aria-hidden 对读屏不可见', () => {
    const html = render(createElement(LoadingSkeleton));
    expect(html).toContain('animate-pulse');
    expect(html).toContain('aria-hidden');
  });
});

/** 防闪烁脚本自身口径：读设置存储键并写 data-theme（与 lib/settings/anti-flash.ts 锚定） */
describe('ANTI_FLASH_SCRIPT 契约', () => {
  it('作用于 data-theme 与 .dark 类，坏值回落 light', () => {
    expect(ANTI_FLASH_SCRIPT).toContain("localStorage.getItem('notesync-settings.v1')");
    expect(ANTI_FLASH_SCRIPT).toContain("setAttribute('data-theme',theme)");
    expect(ANTI_FLASH_SCRIPT).toContain("classList.add('dark')");
    expect(ANTI_FLASH_SCRIPT).toContain("theme='light'");
  });
});
