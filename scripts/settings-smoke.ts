/**
 * 用户设置冒烟：normalizeSettings 边界 + SettingsStorage 接口契约（内存实现）。
 * 零依赖直跑：npm run smoke:settings（与既有 smoke:* 同款，--experimental-strip-types）
 */
import {
  DEFAULT_MODEL_MAX_CHARS,
  MAX_TOKENS_MAX,
  SYSTEM_PROMPT_MAX_CHARS,
  cloneDefaults,
  normalizeSettings,
} from '../lib/settings/types.ts';
import { createMemorySettingsStorage } from '../lib/settings/storage.ts';
import type { UserSettings } from '../lib/settings/types.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean) {
  if (cond) {
    passed += 1;
  } else {
    failures.push(name);
  }
}

function eq(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/* ---------- normalizeSettings：兜底 ---------- */
check('normalize(null) 回落默认', eq(normalizeSettings(null), cloneDefaults()));
check('normalize(undefined) 回落默认', eq(normalizeSettings(undefined), cloneDefaults()));
check('normalize(字符串) 回落默认', eq(normalizeSettings('oops'), cloneDefaults()));
check('normalize(数组) 回落默认', eq(normalizeSettings([1, 2]), cloneDefaults()));
check('normalize(42) 回落默认', eq(normalizeSettings(42), cloneDefaults()));

/* ---------- normalizeSettings：字段收窄 ---------- */
check('theme 非法值回落 light', normalizeSettings({ theme: 'blue' }).theme === 'light');
check('theme dark 保留', normalizeSettings({ theme: 'dark' }).theme === 'dark');
check('theme sky 保留', normalizeSettings({ theme: 'sky' }).theme === 'sky');
check('theme mint 保留', normalizeSettings({ theme: 'mint' }).theme === 'mint');
check('theme 旧值 system 迁移为 light', normalizeSettings({ theme: 'system' }).theme === 'light');
check('theme 缺省回落 light', normalizeSettings({}).theme === 'light');
check('defaultModel 非字符串回落空', normalizeSettings({ defaultModel: 123 }).defaultModel === '');
check(
  'defaultModel 超长截断',
  normalizeSettings({ defaultModel: 'x'.repeat(500) }).defaultModel.length ===
    DEFAULT_MODEL_MAX_CHARS
);
check(
  'systemPrompt 超长截断',
  normalizeSettings({ systemPrompt: 's'.repeat(9999) }).systemPrompt.length ===
    SYSTEM_PROMPT_MAX_CHARS
);

/* ---------- normalizeSettings：generation 钳制 ---------- */
check('temperature 越上界钳到 2', normalizeSettings({ generation: { temperature: 5 } }).generation.temperature === 2);
check('temperature 越下界钳到 0', normalizeSettings({ generation: { temperature: -1 } }).generation.temperature === 0);
check('temperature 非数字丢弃', eq(normalizeSettings({ generation: { temperature: 'x' } }).generation, {}));
check('maxTokens 防呆上限', normalizeSettings({ generation: { maxTokens: 999_999_999 } }).generation.maxTokens === MAX_TOKENS_MAX);
check('maxTokens 向下取整', normalizeSettings({ generation: { maxTokens: 10.9 } }).generation.maxTokens === 10);
check('maxTokens 非正数丢弃', eq(normalizeSettings({ generation: { maxTokens: 0 } }).generation, {}));
check('generation 非对象丢弃', eq(normalizeSettings({ generation: 'high' }).generation, {}));

/* ---------- normalizeSettings：ocr 与未知字段 ---------- */
// 默认档为「全本地」（product-vision.md P4 约束③）：保守侧是 true，只有显式 false 才关闭
check('ocr.preferLocal 缺省回落 true', normalizeSettings({}).ocr.preferLocal === true);
check('ocr.preferLocal 显式 true 生效', normalizeSettings({ ocr: { preferLocal: true } }).ocr.preferLocal === true);
check('ocr.preferLocal 显式 false 才关闭', normalizeSettings({ ocr: { preferLocal: false } }).ocr.preferLocal === false);
check("ocr.preferLocal 'false' 字符串不误关", normalizeSettings({ ocr: { preferLocal: 'false' } }).ocr.preferLocal === true);
check('ocr 非对象回落默认档', normalizeSettings({ ocr: 'local' }).ocr.preferLocal === true);

/* ---------- normalizeSettings：rag（本地检索开关，从严布尔，默认关闭） ---------- */
check('rag.enabled 严格 true', normalizeSettings({ rag: { enabled: true } }).rag.enabled === true);
check("rag.enabled 'true' 字符串视为否", normalizeSettings({ rag: { enabled: 'true' } }).rag.enabled === false);
check('rag 非对象回落默认', normalizeSettings({ rag: 'on' }).rag.enabled === false);
check('rag 缺省回落 false', normalizeSettings({}).rag.enabled === false);

check('未知字段一律丢弃', eq(Object.keys(normalizeSettings({ theme: 'dark', hacked: 1 })), ['theme', 'defaultModel', 'language', 'systemPrompt', 'generation', 'ocr', 'rag']));

/* ---------- 默认值不可变性 ---------- */
const before = JSON.stringify(cloneDefaults());
normalizeSettings({ generation: { temperature: 1.5 } });
check('normalize 不污染默认值', JSON.stringify(cloneDefaults()) === before);

/* ---------- SettingsStorage 契约（内存实现） ---------- */
const storage = createMemorySettingsStorage();
check('空存储 load 回落默认', eq(storage.load(), cloneDefaults()));

const sample: UserSettings = {
  ...cloneDefaults(),
  theme: 'dark',
  defaultModel: 'glm-5.3-flash',
};
storage.save(sample);
check('save/load roundtrip', eq(storage.load(), sample));

storage.save(normalizeSettings({ theme: 'light', generation: { temperature: 3 } }));
const afterSave = storage.load();
check('save 经 normalize 规整', afterSave.theme === 'light' && afterSave.generation.temperature === 2);

storage.clear();
check('clear 后回落默认', eq(storage.load(), cloneDefaults()));

/* ---------- 汇总 ---------- */
console.log(`[smoke:settings] 通过 ${passed} 项${failures.length > 0 ? `，失败 ${failures.length} 项` : ''}`);
if (failures.length > 0) {
  for (const name of failures) console.error(`  ✗ ${name}`);
  process.exit(1);
}
