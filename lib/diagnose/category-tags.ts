/**
 * 诊断模式文件接入 - 附件标签（多值）共享口径
 *
 * 2026-11-15：一个文件允许打多个标签（如一份 PDF 既含「原题」又含「我的错误答案」）。
 * 这里集中放三件事，避免「哪些值合法」「主标签是谁」在多处各写一遍：
 * 1) 白名单（CATEGORY_IDS）与中文名（CATEGORY_LABELS）；
 * 2) 规范化（逐项过滤 + 去重，非法项只剔除自己，不牵连其它项）；
 * 3) 读取（attachmentCategories 兼容旧字段 category）。
 *
 * 本文件同样不得引入运行时依赖：浏览器侧（UploadArea）、Node 侧（服务端校验、
 * 组装、完整度推导）与冒烟脚本共用。
 */
import type { ReviseCategory } from './types.ts';

/** 合法标签，顺序即组装分块顺序（origin → wrong → correct → analysis） */
export const CATEGORY_IDS: ReviseCategory[] = ['origin', 'wrong', 'correct', 'analysis'];

/** 标签中文名：UI chip 与组装的文件描述行共用同一套字面量 */
export const CATEGORY_LABELS: Record<ReviseCategory, string> = {
  origin: '错题原题',
  wrong: '错误答案',
  correct: '正确答案',
  analysis: '标准解析',
};

/** 标签缺省值：前端允许一个文件不打标签，服务端按主标签 origin 兜底（doc/diagnose-file-intake.md §2） */
export const DEFAULT_CATEGORY: ReviseCategory = 'origin';

export function isReviseCategory(value: unknown): value is ReviseCategory {
  return typeof value === 'string' && CATEGORY_IDS.includes(value as ReviseCategory);
}

/**
 * 标签数组规范化：逐项白名单过滤 + 去重（保持第一次出现的顺序）。
 * 非法项只剔除该项——单个脏标签不该让整条附件作废；非数组输入返回空数组。
 */
export function normalizeCategories(raw: unknown): ReviseCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: ReviseCategory[] = [];
  for (const item of raw) {
    if (!isReviseCategory(item)) continue;
    if (out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

/**
 * 取一个附件的全部标签。
 * 新字段 categories 优先；旧客户端只发单值 category 时包成单元素数组（兼容期一版）。
 * 两者都缺（或都为空）返回空数组，调用方自行决定兜底。
 */
export function attachmentCategories(item: {
  categories?: ReviseCategory[];
  category?: ReviseCategory;
}): ReviseCategory[] {
  if (item.categories && item.categories.length > 0) return item.categories;
  return item.category ? [item.category] : [];
}

/**
 * 主标签：决定该附件落进哪个组装分块（也就决定锚点计数归谁）。
 * 多标签时取第一项，其余标签只写进文件描述行，内容不会重复上行。
 */
export function primaryCategory(item: {
  categories?: ReviseCategory[];
  category?: ReviseCategory;
}): ReviseCategory | undefined {
  return attachmentCategories(item)[0];
}

/**
 * 追加一个标签（上传区「+ 添加标签」）：已存在则原样返回，满四类也原样返回。
 * 抽成纯函数是为了让「不可重复 / 不超上限」这条规则可单测——
 * 组件测试需要 jsdom，仓库测试环境是 node（vitest.config.mts）。
 */
export function appendCategoryTag(
  current: ReviseCategory[],
  next: ReviseCategory
): ReviseCategory[] {
  if (!isReviseCategory(next)) return current;
  if (current.includes(next)) return current;
  if (current.length >= CATEGORY_IDS.length) return current;
  return [...current, next];
}

/** 移除一个标签：其余标签保持原顺序，首项被移除后下一项自动递补为主标签 */
export function removeCategoryTag(
  current: ReviseCategory[],
  target: ReviseCategory
): ReviseCategory[] {
  return current.filter((item) => item !== target);
}
