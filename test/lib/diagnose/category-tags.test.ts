/**
 * 附件标签多值口径用例（2026-11-15）。
 *
 * 上传区标签从「单选下拉」改成「可添加多个标签」后，规则集中到 category-tags.ts：
 * 白名单过滤、去重、旧字段兼容、主标签认定，以及 UI 增删动作。
 * 组件测试需要 jsdom（vitest.config.mts 固定 node 环境），因此把「不可重复 / 不超上限
 * / 移除后主标签递补」这三条交互规则抽成纯函数，在这里直接覆盖。
 */
import { describe, expect, it } from 'vitest';
import {
  appendCategoryTag,
  attachmentCategories,
  CATEGORY_IDS,
  CATEGORY_LABELS,
  DEFAULT_CATEGORY,
  isReviseCategory,
  normalizeCategories,
  primaryCategory,
  removeCategoryTag,
} from '../../../lib/diagnose/category-tags.ts';
import type { ReviseCategory } from '../../../lib/diagnose/types.ts';

describe('白名单与中文名', () => {
  it('四类标签，顺序即组装分块顺序', () => {
    expect(CATEGORY_IDS).toEqual(['origin', 'wrong', 'correct', 'analysis']);
  });

  it('中文名与锚点一一对应', () => {
    expect(CATEGORY_LABELS).toEqual({
      origin: '错题原题',
      wrong: '错误答案',
      correct: '正确答案',
      analysis: '标准解析',
    });
  });

  it('缺省标签为 origin', () => {
    expect(DEFAULT_CATEGORY).toBe('origin');
    expect(isReviseCategory(DEFAULT_CATEGORY)).toBe(true);
  });

  it('非四类值一律不认', () => {
    for (const bad of ['', 'bad', 'Origin', null, undefined, 1, {}, []]) {
      expect(isReviseCategory(bad)).toBe(false);
    }
  });
});

describe('normalizeCategories：逐项过滤 + 去重', () => {
  it('保留合法项并去重（首次出现顺序为准）', () => {
    expect(normalizeCategories(['wrong', 'origin', 'wrong'])).toEqual(['wrong', 'origin']);
  });

  it('非法项只剔除自己，不牵连其它项', () => {
    expect(normalizeCategories(['analysis', 'bad', 'correct'])).toEqual(['analysis', 'correct']);
  });

  it('全部非法返回空数组（由调用方决定是否整条丢弃）', () => {
    expect(normalizeCategories(['bad', null])).toEqual([]);
  });

  it('非数组输入返回空数组，不抛错', () => {
    expect(normalizeCategories(undefined)).toEqual([]);
    expect(normalizeCategories('origin')).toEqual([]);
  });
});

describe('attachmentCategories：新字段优先、旧字段兼容', () => {
  it('有 categories 时用它', () => {
    expect(attachmentCategories({ categories: ['wrong', 'correct'] })).toEqual([
      'wrong',
      'correct',
    ]);
  });

  it('只有旧单值 category 时包成单元素数组', () => {
    expect(attachmentCategories({ category: 'analysis' })).toEqual(['analysis']);
  });

  it('两者都缺返回空数组（兜底交给 parseAttachments）', () => {
    expect(attachmentCategories({})).toEqual([]);
    expect(attachmentCategories({ categories: [] })).toEqual([]);
  });

  it('新旧同时存在时以新字段为准，不叠加旧值', () => {
    expect(attachmentCategories({ categories: ['wrong'], category: 'origin' })).toEqual(['wrong']);
  });
});

describe('primaryCategory：首项决定组装分块', () => {
  it('多标签取第一项', () => {
    expect(primaryCategory({ categories: ['correct', 'wrong'] })).toBe('correct');
  });

  it('旧单值字段同样可用', () => {
    expect(primaryCategory({ category: 'origin' })).toBe('origin');
  });

  it('无标签返回 undefined（不猜默认值）', () => {
    expect(primaryCategory({})).toBeUndefined();
  });
});

describe('上传区增删标签（appendCategoryTag / removeCategoryTag）', () => {
  it('追加新标签：保持添加顺序', () => {
    expect(appendCategoryTag(['origin'], 'wrong')).toEqual(['origin', 'wrong']);
  });

  it('重复添加同一标签：原样返回，不产生重复项', () => {
    const current = ['origin', 'wrong'] as const;
    const next = appendCategoryTag([...current], 'origin');
    expect(next).toEqual(['origin', 'wrong']);
  });

  it('未选时追加首个标签即可用（初始为空数组）', () => {
    expect(appendCategoryTag([], 'analysis')).toEqual(['analysis']);
  });

  it('四类全选后不再增长（上限即四类）', () => {
    const full = [...CATEGORY_IDS];
    expect(appendCategoryTag(full, 'origin')).toEqual(full);
    expect(appendCategoryTag(full, 'wrong')).toHaveLength(CATEGORY_IDS.length);
  });

  it('非法值不写入（防脏数据从 UI 进入状态）', () => {
    expect(appendCategoryTag(['origin'], 'bad' as never)).toEqual(['origin']);
  });

  it('追加不修改入参数组', () => {
    const current: ReviseCategory[] = ['origin'];
    appendCategoryTag(current, 'wrong');
    expect(current).toEqual(['origin']);
  });

  it('移除只删目标项，其余顺序不变', () => {
    expect(removeCategoryTag(['origin', 'wrong', 'correct'], 'wrong')).toEqual([
      'origin',
      'correct',
    ]);
  });

  it('移除首项后，下一项递补为主标签', () => {
    const remaining = removeCategoryTag(['wrong', 'correct'], 'wrong');
    expect(primaryCategory({ categories: remaining })).toBe('correct');
  });

  it('移除未选中的标签（连点 ×）不改变数组', () => {
    expect(removeCategoryTag(['origin'], 'wrong')).toEqual(['origin']);
  });

  it('全部移除后回到空状态，允许重新添加且不重复', () => {
    let tags = removeCategoryTag(removeCategoryTag(['origin'], 'origin'), 'origin');
    expect(tags).toEqual([]);
    tags = appendCategoryTag(tags, 'origin');
    tags = appendCategoryTag(tags, 'origin');
    expect(tags).toEqual(['origin']);
  });
});
