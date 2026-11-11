/**
 * 对错确定性判定（mathjs）
 *
 * 定位：wip-diagnosis-model.md 理念 3——机械判定只是「按来源定可信度的证据」之一，
 * 结果注入提示词供模型参考，不直接当最终对错结论；解析失败安全降级为无法判定，绝不抛错打断诊断。
 * 服务端专用（mathjs 体积大，不进浏览器包）。
 */
import { parse, simplify } from 'mathjs';
import type { MathNode } from 'mathjs';

export type VerifyVerdict = 'equivalent' | 'not_equivalent' | 'unverifiable';

export interface VerifyResult {
  verdict: VerifyVerdict;
  /** 中文说明，随证据注入提示词 */
  reason: string;
  /** 两边数值核心相等但单位表述不同——unit_error 的直接线索，交模型裁量 */
  unitMismatch?: boolean;
}

/** 单值长度上限：防超长串拖垮 parse/simplify；超限直接无法判定 */
const MAX_VALUE_CHARS = 200;

/** 数值相等判定的相对容差 */
const EPSILON = 1e-9;

/** 全角/常见数学记号归一为 mathjs 可解析形态。上标先映射再 NFKC——NFKC 会把 ² 退化成 2，次序反了映射失效 */
function toMathNotation(text: string): string {
  return text
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    // ± 展开为两个值（"x=±2" 即 "x=2 或 x=-2"），交给 splitValues 按分隔符拆开
    .replace(/±\s*([\p{L}\p{N}.]+)/gu, '$1 或 -$1')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/√\(([^()]+)\)/g, 'sqrt($1)')
    .replace(/√([\p{L}\p{N}.]+)/gu, 'sqrt($1)')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3');
}

/** 去掉「x=」「答：」「解：」这类外壳；赋值前缀视为记法而非表达式内容 */
function stripLabel(text: string): string {
  return text.replace(/^(答|解|答案|结果)[:：]?/, '').replace(/^[a-zA-Z][:=]/, '');
}

/** 按常见分隔符拆多值答案（「x=3 或 x=-1」「2, 3」），拆不动的单值原样返回 */
function splitValues(text: string): string[] {
  return text
    .split(/[或,，;；、|\n]+/)
    .map((part) => stripLabel(part).trim())
    .filter(Boolean);
}

/** 提取数值核心与中文单位；单位差异是诊断线索，比对前先摘出来单独报告 */
function extractUnit(value: string): { core: string; unit?: string } {
  const match = value.match(/([\u4e00-\u9fa5]+)$/);
  if (!match) return { core: value };
  return { core: value.slice(0, value.length - match[1].length), unit: match[1] };
}

function tryParse(text: string): MathNode | null {
  try {
    return parse(text);
  } catch {
    return null;
  }
}

/** 两式恒等：simplify(差式) 收敛为常数 0；内部失败返回 null 交给数值兜底 */
function isIdentical(a: MathNode, b: MathNode): boolean | null {
  try {
    const diffNode = parse(`(${a.toString()}) - (${b.toString()})`);
    return simplify(diffNode).toString() === '0';
  } catch {
    return null;
  }
}

/** 数值兜底：两边都能算出常数时按相对容差比较 */
function numericEqual(a: MathNode, b: MathNode): boolean | null {
  try {
    const va = a.evaluate();
    const vb = b.evaluate();
    if (typeof va !== 'number' || typeof vb !== 'number') return null;
    return Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb), 1) < EPSILON;
  } catch {
    return null;
  }
}

/** 单值对比。可判定时 equal 为确定布尔；返回 null 表示这一对无法机械判定 */
function comparePair(studentRaw: string, correctRaw: string): { equal: boolean; reason: string; unitMismatch?: boolean } | null {
  const s = extractUnit(stripLabel(toMathNotation(studentRaw)));
  const c = extractUnit(stripLabel(toMathNotation(correctRaw)));
  if (!s.core || !c.core) return null;
  if (s.core.length > MAX_VALUE_CHARS || c.core.length > MAX_VALUE_CHARS) {
    return null;
  }

  const unitMismatch = (s.unit ?? '') !== (c.unit ?? '') || undefined;
  if (s.core === c.core) return { equal: true, reason: '两答数值核心一致', unitMismatch };

  const sNode = tryParse(s.core);
  const cNode = tryParse(c.core);
  if (!sNode || !cNode) return null;

  const identical = isIdentical(sNode, cNode);
  if (identical !== null) {
    return { equal: identical, reason: identical ? '化简后两式恒等' : '化简后两式不等', unitMismatch };
  }
  const numeric = numericEqual(sNode, cNode);
  if (numeric !== null) {
    return { equal: numeric, reason: numeric ? '数值计算结果一致' : '数值计算结果不一致', unitMismatch };
  }
  return null;
}

/**
 * 判定学生答案与正确答案是否等价。
 * 多值答案按集合比对：数量不一致本身就是诊断线索（如漏根 → case_miss），判 not_equivalent。
 * 配对只消费「判定相等」的命中——学生值先在正确池里找等价值，找不到再回头取失败对照的理由。
 */
export function verifyAnswerEquivalence(student: string, correct: string): VerifyResult {
  const studentValues = splitValues(toMathNotation(student));
  const correctValues = splitValues(toMathNotation(correct));
  if (studentValues.length === 0 || correctValues.length === 0) {
    return { verdict: 'unverifiable', reason: '未提取到可判定的答案' };
  }

  const correctPool = [...correctValues];
  const matchedUnitMismatch: boolean[] = [];
  let unmatched = 0;
  let failReason: string | null = null;
  for (const studentValue of studentValues) {
    const matchIndex = correctPool.findIndex((correctValue) => comparePair(studentValue, correctValue)?.equal === true);
    if (matchIndex >= 0) {
      const pair = comparePair(studentValue, correctPool[matchIndex]);
      if (pair?.unitMismatch) matchedUnitMismatch.push(true);
      correctPool.splice(matchIndex, 1);
      continue;
    }
    // 没有等价命中：区分「判定不等」（可给理由）与「无法判定」（整体降级）
    const failed = correctPool
      .map((correctValue) => comparePair(studentValue, correctValue))
      .find((pair) => pair && !pair.equal);
    if (!failed) return { verdict: 'unverifiable', reason: '部分答案无法机械判定，交由模型裁量' };
    unmatched += 1;
    failReason ??= failed.reason;
  }

  if (unmatched > 0) {
    return { verdict: 'not_equivalent', reason: `有 ${unmatched} 个作答值与正确答案不等（${failReason}）` };
  }
  // 学生值全部配对成功且正确值无剩余才等价——多解漏答不算等价
  if (correctPool.length > 0) {
    return { verdict: 'not_equivalent', reason: `正确答案含 ${correctPool.length} 个学生未给出的值（可能漏解）` };
  }
  const anyUnitMismatch = matchedUnitMismatch.length > 0 || undefined;
  return {
    verdict: 'equivalent',
    reason: anyUnitMismatch ? '数值等价但单位表述不同' : '答案等价',
    unitMismatch: anyUnitMismatch,
  };
}
