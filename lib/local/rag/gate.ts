/*
 * RAG 触发条件（纯函数，无 IO、无 Worker、无浏览器 API）
 *
 * 协议见 doc/browser-local-inference.md §5.4：
 *   v1 语料为内置种子知识卡（常识性知识点），短查询（问候、单符号、纯数字）
 *   几乎不可能命中，却仍要付出一次查询嵌入与 IndexedDB 读取——故按查询侧
 *   字符数设下限，低于 RAG_MIN_QUERY_CHARS 直接不检索。
 *
 * 语料侧阈值（笔记/会话语料 ≥ 3000 字才建索引）属 §8 挂账，本期语料固定为
 * 种子卡，不落地该阈值。
 */

/**
 * 查询侧最小有效字符数（去空白后计）。
 * 8 字符可容纳一个最短的完整数学提问（如「二次函数顶点怎么求」= 9 字符），
 * 同时挡住问候、道谢、单符号与纯数字算式（「这题怎么做」= 5 字符）。
 * 定 12 会误伤「二次函数顶点坐标怎么求」（11 字符）这类正常问句，故不取。
 */
export const RAG_MIN_QUERY_CHARS = 8;

/**
 * 统计查询的有效字符数：去掉全部空白后按「字符」计，
 * 用 Array.from 展开，避免代理对（emoji、罕见汉字）被算作 2 个字符。
 */
export function countQueryChars(query: string): number {
  return Array.from(query.replace(/\s+/g, '')).length;
}

/** 是否应当为本条查询发起本地检索 */
export function shouldRetrieve(query: string): boolean {
  return countQueryChars(query) >= RAG_MIN_QUERY_CHARS;
}
