/**
 * Markdown 渲染净化白名单
 *
 * 背景：ChatList 用 rehypeRaw 渲染模型输出里的原始 HTML，而模型输出会被用户上传的
 * PDF / 图片抽出的文本影响，等于把不可信文本直接交给浏览器解析执行。
 * 这里保留 rehypeRaw（HTML 表格等仍需渲染），在其后插入白名单净化。
 *
 * 插件顺序不可随意调整（改前请先看 reasons）：
 *   [rehypeRaw, rehypeSanitizeMarkdown, rehypeKatex]
 * - 净化必须在 rehypeRaw 之后：raw HTML 要先变成 hast 节点，白名单才有东西可查。
 * - 净化必须在 rehypeKatex 之前：KaTeX 产物依赖 span 的 class/style，若在净化前渲染
 *   会被剥成纯文本，公式直接碎掉。
 */
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';

/**
 * GitHub 白名单基座 + 公式所需的最小补充。
 *
 * remark-math 把公式产出为 <code class="language-math math-inline">（行内）和
 * <pre><code class="language-math math-display">（块级），而默认白名单对 code 的
 * className 只放行 /^language-./，会把 math-inline / math-display 剥掉，
 * 之后 rehype-katex 找不到公式节点。这里只补这两个固定字符串，其余规则一律不放宽。
 */
export const markdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
};

/** 供 rehypePlugins 直接引用的净化插件 */
export function rehypeSanitizeMarkdown() {
  return rehypeSanitize(markdownSanitizeSchema);
}
