/**
 * 输入侧本地前置过滤（safety-protocol.md §4）
 *
 * 定位：客户端优先，数据不出端——命中即在本机拦截，消息不进诊断流程、不发请求。
 * 服务端**不依赖**这条链路：app/api/chat/route.ts 会用同一个 checkInputSafety 独立再判一次
 * （改包/旧版本缓存/直接打接口都能绕过客户端，服务端必须自己兜底）。
 *
 * 三条判定线（前两条不依赖任何词表，默认启用）：
 * 1. 结构规则：超长/纯乱码/重复刷屏；
 * 2. 指令结构规则：提示注入句式（lib/safety/injection-patterns.ts，15 条中英文特征）；
 * 3. 词表规则：高风险硬拦截 / 心理困扰关怀转介（默认空，走配置覆盖）。
 *
 * **词表不随仓库分发具体内容**（§4 表格约束）：本文件只放规则骨架与判定引擎，
 * 实际词表走配置覆盖（localStorage `notesync-wordlist-v1`），默认内置词表为空。
 *
 * 语义判定（隐含违规）不做本地实现：交给上游 + 响应形态归一（content_blocked）。
 */
import { matchInjection } from './injection-patterns.ts';
import type { SafetyLevel } from './messages.ts';

/** 词表类别 → 处置级别：高风险硬拦截；心理困扰关怀转介（§5.1/§5.3） */
export type WordlistCategory = 'hardRisk' | 'psych';

/** 输入命中类别：两个词表类别 + 指令结构（注入）类别 */
export type InputSafetyCategory = WordlistCategory | 'injection';

export interface WordlistConfig {
  hardRisk: string[];
  psych: string[];
}

/**
 * 空词表骨架：实际内容由配置注入，仓库不分发（§4）。
 *
 * 为什么默认留空而不是内置一份"敏感词"（设计取舍，详见 doc/safety-design.md §3）：
 * 1. 词表永远不全——漏一个就等于对外宣称"已覆盖"，却拿不出覆盖证明，送审时反而是负担；
 * 2. 中文同音、拼音、拆字、繁简混写绕过低成本，词库要持续追热点，维护成本不封顶；
 * 3. 学科文本天然撞词（物理的爆炸/燃烧、化学的制取/配比、生物的麻醉/毒理），
 *    一刀切会把正当错题挡在门外，误伤比漏拦更伤核心场景；
 * 4. 违规内容判定本就有上游承担（content_blocked）+ 服务端注入兜底，
 *    再叠一层关键词审查只增加误伤面，不增加可证明的防护。
 * 需要按业务方要求临时加固时，走 localStorage 配置注入，不改代码、不影响默认部署。
 */
export const DEFAULT_WORDLIST: WordlistConfig = { hardRisk: [], psych: [] };

/** 结构规则阈值（D 级可调） */
export const STRUCTURE_RULES = {
  /** 单条输入最大字符数，超过视为超长（24000≈整卷粘贴量级；8000 曾把贴整张试卷误拦） */
  maxChars: 24000,
  /** 重复刷屏判定：同一段 ≥10 字内容重复次数 */
  repeatCount: 8,
} as const;

export interface InputSafetyResult {
  /** null = 未命中，消息可正常发送 */
  level: SafetyLevel | null;
  category?: InputSafetyCategory;
  reason?: string;
}

export const WORDLIST_STORAGE_KEY = 'notesync-wordlist-v1';

/**
 * 读取词表配置：localStorage 覆盖 → 默认骨架。
 * 配置解析失败一律回落默认（过滤是纯增益，坏配置不能阻断发送）。
 */
export function loadWordlist(): WordlistConfig {
  if (typeof window === 'undefined') return DEFAULT_WORDLIST;
  try {
    const raw = window.localStorage.getItem(WORDLIST_STORAGE_KEY);
    if (!raw) return DEFAULT_WORDLIST;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pick = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
    return { hardRisk: pick(parsed.hardRisk), psych: pick(parsed.psych) };
  } catch {
    return DEFAULT_WORDLIST;
  }
}

/** 纯乱码判定：去空白后可打印可见字符占比过低（控制符/私有区占多数） */
export function isMostlyGarbage(text: string): boolean {
  const visible = text.replace(/\s/g, '');
  if (visible.length < 20) return false; // 太短不判
  const printable = visible.replace(/[^\u0020-\u007e\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g, '');
  return printable.length / visible.length < 0.3;
}

/** 重复刷屏判定：等距取 5 个 12 字采样片段，任一片段在全文中出现次数达阈值即命中 */
function isSpamRepeat(text: string): boolean {
  if (text.length < 24) return false;
  const SAMPLES = 5;
  const SEGMENT = 12;
  for (let i = 0; i < SAMPLES; i++) {
    const start = Math.floor(((text.length - SEGMENT) * i) / (SAMPLES - 1));
    const seg = text.slice(start, start + SEGMENT).trim();
    if (seg.length < 10) continue;
    if (text.split(seg).length - 1 >= STRUCTURE_RULES.repeatCount) return true;
  }
  return false;
}

/**
 * 输入安全判定（纯函数，客户端发送前与服务端各调用一次）。
 * 顺序：结构规则 → 心理困扰（关怀优先于拦截：同一输入两类都命中时按 §5.3 处理）
 * → 提示注入（指令结构）→ 高风险硬拦截。
 *
 * 提示注入放在心理困扰之后：表达困扰的输入不能因为夹了「忽略之前的要求」这类
 * 转述句式就被当成攻击硬拒，关怀优先。
 */
export function checkInputSafety(
  text: string,
  wordlist: WordlistConfig = DEFAULT_WORDLIST,
): InputSafetyResult {
  if (text.length > STRUCTURE_RULES.maxChars) {
    return { level: 'hard', reason: `输入超过 ${STRUCTURE_RULES.maxChars} 字符上限` };
  }
  if (isMostlyGarbage(text)) {
    return { level: 'hard', reason: '输入内容无法解析（疑似乱码）' };
  }
  if (isSpamRepeat(text)) {
    return { level: 'hard', reason: '输入存在大量重复内容' };
  }

  // 词表匹配用包含判定：词表条目即匹配串（维护方自行决定词/短语粒度）
  if (wordlist.psych.some((word) => text.includes(word))) {
    return { level: 'psych', category: 'psych', reason: '命中心理困扰词表' };
  }

  // 指令结构规则：不依赖词表，只看是否在改写系统指令（见 injection-patterns.ts 文件头）
  const injection = matchInjection(text);
  if (injection) {
    return {
      level: 'hard',
      category: 'injection',
      reason: `命中提示注入特征：${injection.label}（${injection.id}）`,
    };
  }

  if (wordlist.hardRisk.some((word) => text.includes(word))) {
    return { level: 'hard', category: 'hardRisk', reason: '命中高风险词表' };
  }
  return { level: null };
}
