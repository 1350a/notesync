/**
 * 错因 → 策略卡常量表
 *
 * 契约来源：doc/diagnosis-model.md §4。策略不因题目而异，按错因 code 直查，不做检索。
 * 条目属 D 级约束：措辞可实测调整，但 StrategyCard 接口形状是硬项，变更须同批更新文档。
 */
import type { ErrorCode } from './error-causes.ts';
import type { StrategyCard } from './types.ts';

/** 结构变更时递增；DiagnosisResult.strategyVersion 与此对齐 */
export const STRATEGY_VERSION = 1;

const steps: Record<ErrorCode, string[]> = {
  misread: [
    '圈条件、圈问句、圈单位，三样各划一处',
    '读完后用自己的话把题目复述一遍再动笔',
    '动笔前对照划线处自问：问句要求的是什么量',
  ],
  pure_guess: [
    '控制时间分配，留出固定的复核窗口',
    '结果代回原题验证，不凭感觉确认',
    '检查时只查勾选是否与结论一致，不重做',
  ],
  calc_error: [
    '分步验算，每步只查一个运算',
    '符号单独走一遍（正负、移项变号）',
    '把结果代回原式检验',
  ],
  transcribe: [
    '抄写后逐项与题干比对（数字、符号、下标）',
    '养成「抄完回头看一眼」的习惯再动笔',
  ],
  concept_confuse: [
    '把易混概念并排列定义对比表',
    '各找一个反例辨析边界',
    '用自己的话说清两者「差在哪一个条件」',
  ],
  formula_misuse: [
    '写出公式的适用条件清单',
    '用公式前先逐条核对条件是否满足',
    '超范围使用时回到定义重新推导',
  ],
  hidden_cond: [
    '三步检查：分母 ≠ 0 / 根号内 ≥ 0 / 对数真数 > 0',
    '函数题动笔前先写定义域',
    '整理最终答案时按定义域剔除非法解',
  ],
  case_miss: [
    '按参数扫描清单逐档讨论（正/负/零）',
    '含判别式问题按判别式符号分档',
    '收尾核对：各档结论是否覆盖全部取值且不重叠',
  ],
  step_jump: [
    '每一步写明依据（用了哪个定理/公式）',
    '写不出依据的那一步就是断层，回到上一步补证',
  ],
  modeling_error: [
    '先写「已知→所求」的对应关系再列式',
    '用特殊值代入检验列出的式子是否合理',
  ],
  boundary_error: [
    '单独检查端点：能否取等、开闭是否对应',
    '不等式方向与系数正负联动核对',
  ],
  graph_misread: [
    '先在图上标出所有关键点（交点、顶点、端点）',
    '读数前先确认坐标轴的含义与刻度',
  ],
  unit_error: [
    '解题前统一单位',
    '答案必须带单位',
    '做一次量纲自检（结果单位是否与所求一致）',
  ],
  answer_off_target: [
    '收尾三问：题目问什么？我算的是什么？要不要带单位/范围？',
    '回答前把问句抄在答案旁对照',
  ],
};

/** 14 张卡与错因表一一对应；id 用错因 code 本身——卡与错因严格一对一，无第二来源 */
export const STRATEGY_CARDS: Record<ErrorCode, StrategyCard> = Object.fromEntries(
  (Object.keys(steps) as ErrorCode[]).map((code) => [
    code,
    { errorCode: code, id: code, steps: steps[code], subject: 'math', version: STRATEGY_VERSION },
  ]),
) as Record<ErrorCode, StrategyCard>;

/** 按错因 code 直查策略卡；调用方须先用 isKnownErrorCode 过滤 */
export function findStrategyCard(code: ErrorCode): StrategyCard {
  return STRATEGY_CARDS[code];
}
