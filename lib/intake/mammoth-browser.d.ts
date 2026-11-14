/**
 * mammoth 预编译浏览器包（mammoth/mammoth.browser.min.js）无自带类型；
 * API 与 'mammoth' 主入口一致，直接复用其类型声明。
 */
declare module 'mammoth/mammoth.browser.min.js' {
  import type * as mammoth from 'mammoth';

  const mammothBrowser: typeof mammoth;
  export default mammothBrowser;
}
