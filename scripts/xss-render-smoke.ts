/**
 * Markdown 渲染 XSS 冒烟测试（Node 原生 strip-types，零依赖直跑）
 *
 * 运行：`npm run smoke:xss`
 * 或：  `node scripts/xss-render-smoke.ts`
 *
 * 用 react-dom/server 在进程内跑 chat 气泡同款插件链，断言：
 * 1. 危险载荷（事件属性、script、javascript: 协议、iframe/data:、svg、MathML）被净化
 * 2. 正常能力不被误杀：GFM 表格、行内/块级公式、代码高亮 class、任务列表、details、链接
 * 3. 对照组：未净化配置确实会放行攻击载荷，证明上面的断言不是空转
 *
 * 不依赖浏览器与真实模型，纯服务端渲染。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { rehypeSanitizeMarkdown } from '../lib/markdown/sanitize.ts';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

/** 与 components/chat/ChatList.tsx 保持一致的插件链，顺序由 lib/markdown/sanitize.ts 约定 */
function render(markdown: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [rehypeRaw, rehypeSanitizeMarkdown, rehypeKatex],
    }, markdown)
  );
}

/** 对照组：只挂 rehypeRaw，模拟修复前“原始 HTML 直通”的行为 */
function renderUnsafe(markdown: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [rehypeRaw],
    }, markdown)
  );
}

function includesInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

const UNSAFE_CASES: { name: string; markdown: string; forbidden: string[] }[] = [
  {
    name: 'img onerror',
    markdown: '看图 <img src=x onerror="alert(1)">',
    forbidden: ['onerror'],
  },
  {
    name: 'script 标签',
    markdown: '前 <script>alert(1)</script> 后',
    forbidden: ['<script', 'alert(1)'],
  },
  {
    name: 'Markdown 链接里的 javascript: 协议',
    markdown: '[点我](javascript:alert(1))',
    forbidden: ['javascript:'],
  },
  {
    name: '大小写混写的 javascript: 协议',
    markdown: '<a href="JaVaScRiPt:alert(1)">点我</a>',
    forbidden: ['javascript:'],
  },
  {
    name: 'iframe + data:text/html',
    markdown: '<iframe src="data:text/html,<h1>pwn</h1>"></iframe>',
    forbidden: ['<iframe', 'data:text/html'],
  },
  {
    name: 'svg onload',
    markdown: '<svg/onload="alert(1)"></svg>',
    // 这种不闭合属性写法在本管线里会退化成被转义文本，断言“不得出现 svg 元素”
    forbidden: ['<svg'],
  },
  {
    name: 'MathML mtext 内嵌 script',
    markdown: '<math><mtext><script>alert(1)</script></mtext></math>',
    forbidden: ['<script', '<math'],
  },
  {
    name: 'div 上的事件属性',
    markdown: '<div onclick="alert(1)">点我</div>',
    forbidden: ['onclick'],
  },
  {
    name: 'style 注入',
    markdown: '<div style="position:fixed;top:0;left:0;width:100vw;height:100vh">遮罩</div>',
    forbidden: ['position:fixed'],
  },
];

console.log('\n[1] 危险载荷必须被净化');
for (const item of UNSAFE_CASES) {
  const html = render(item.markdown);
  const leaked = item.forbidden.filter((token) => includesInsensitive(html, token));
  assert(leaked.length === 0, `${item.name}${leaked.length ? `（泄漏 ${leaked.join(' / ')}）` : ''}`);
}

console.log('\n[2] 正常 Markdown 能力不得误杀');
{
  const table = render('| 列A | 列B |\n| --- | --- |\n| 1 | 2 |');
  assert(table.includes('<table'), 'GFM 表格仍渲染 <table>');
  assert(table.includes('<th'), 'GFM 表头仍渲染 <th>');
}
{
  const inline = render('行内公式 $a^2+b^2=c^2$ 结束');
  assert(inline.includes('class="katex"'), '行内公式仍由 KaTeX 渲染（katex class 保留）');
}
{
  const block = render('$$\n\\frac{1}{2}\n$$');
  assert(block.includes('katex-display'), '块级公式仍渲染为 katex-display');
}
{
  const code = render('```ts\nconst a: number = 1;\n```');
  assert(code.includes('language-ts'), '代码块语言 class 保留');
  assert(code.includes('<pre'), '代码块 <pre> 保留');
}
{
  const task = render('- [x] 已完成\n- [ ] 未完成');
  assert(task.includes('type="checkbox"'), '任务列表复选框保留');
}
{
  const details = render('<details><summary>展开</summary>正文</details>');
  assert(details.includes('<details'), '<details> 折叠块保留');
  assert(details.includes('<summary'), '<summary> 保留');
}
{
  const link = render('[官网](https://example.com/docs)');
  assert(link.includes('href="https://example.com/docs"'), 'https 链接保留');
}
{
  const styled = render('<div style="position:fixed;top:0">遮罩</div>');
  assert(styled.includes('遮罩'), '被剥掉危险属性的元素，其文本仍保留');
}
{
  const heading = render('# 标题\n\n**加粗** 与 `行内代码`');
  assert(heading.includes('<h1'), '标题保留');
  assert(heading.includes('<strong>'), '加粗保留');
  assert(heading.includes('<code>'), '行内代码保留');
}

console.log('\n[3] 对照组：未净化配置确实会放行（证明断言非空转）');
{
  // 注意：React 自身会丢弃事件属性、react-markdown 默认 urlTransform 也会清空危险协议，
  // 所以对照组只选“渲染层真会漏”的两类：style 注入与 script 标签直通。
  const styleMd = '<div style="position:fixed;top:0">遮罩</div>';
  assert(
    includesInsensitive(renderUnsafe(styleMd), 'position:fixed'),
    '仅 rehypeRaw 时 style 注入确实生效'
  );
  assert(
    !includesInsensitive(render(styleMd), 'position:fixed'),
    '加净化后同样的 style 注入被剥掉'
  );

  const scriptMd = '<math><mtext><script>alert(1)</script></mtext></math>';
  assert(
    includesInsensitive(renderUnsafe(scriptMd), '<script'),
    '仅 rehypeRaw 时 <script> 确实出现在输出中'
  );
  assert(
    !includesInsensitive(render(scriptMd), '<script'),
    '加净化后同样的 <script> 被移除'
  );
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;
