/**
 * 错因枚举表（数学 v1）
 *
 * 契约来源：doc/diagnosis-model.md §3，14 条逐字。
 * 错因为有限枚举是整个设计的基石：策略卡按 code 直查，不做检索。
 * 条目属 D 级约束：实测后可增删调整，不必回头改文档。
 */

/** 单条错因定义 */
export interface ErrorCauseDef {
  /** 稳定 code，模型输出对齐与策略卡直查都以它为键 */
  code: string;
  /** 中文标签，UI 直显 */
  label: string;
  /** 典型表现，供 L1 补问话术与提示词引用 */
  symptom: string;
  /** 是否知识性错因：知识性补知识，非知识性改习惯 */
  knowledgeGap: boolean;
}

/** 14 条错因，顺序即文档 §3 表顺序 */
export const ERROR_CAUSES = [
  { code: 'misread', label: '审题不清', symptom: '漏条件、看错问句、看错符号', knowledgeGap: false },
  { code: 'pure_guess', label: '纯粹选错', symptom: '会做但勾错，无知识断点', knowledgeGap: false },
  { code: 'calc_error', label: '计算失误', symptom: '算术、符号、移项、约分', knowledgeGap: false },
  { code: 'transcribe', label: '抄写错误', symptom: '从题干抄下来就抄错', knowledgeGap: false },
  { code: 'concept_confuse', label: '概念混淆', symptom: '定义理解错误', knowledgeGap: true },
  { code: 'formula_misuse', label: '公式误用', symptom: '记错公式或超范围使用', knowledgeGap: true },
  { code: 'hidden_cond', label: '隐含条件遗漏', symptom: '定义域、分母非零、根号非负、判别式条件', knowledgeGap: true },
  { code: 'case_miss', label: '分类讨论遗漏', symptom: '含参数问题漏分支', knowledgeGap: true },
  { code: 'step_jump', label: '步骤断层', symptom: '中间步骤无依据地跳过', knowledgeGap: true },
  { code: 'modeling_error', label: '转化/建模错误', symptom: '应用题列式错、图形转代数错', knowledgeGap: true },
  { code: 'boundary_error', label: '边界处理错误', symptom: '端点取闭/开、不等式方向', knowledgeGap: true },
  { code: 'graph_misread', label: '图象误判', symptom: '读图看错交点/单调性', knowledgeGap: true },
  { code: 'unit_error', label: '单位/量纲错误', symptom: '单位未统一、量纲不对', knowledgeGap: false },
  { code: 'answer_off_target', label: '答非所问', symptom: '算出来了但没回答题目问的', knowledgeGap: false },
] as const satisfies readonly ErrorCauseDef[];

/** 全部合法 code 的字面量联合，策略卡与状态机消费方使用 */
export type ErrorCode = (typeof ERROR_CAUSES)[number]['code'];

/** 模型输出不可信，code 进系统前先过此守卫 */
export function isKnownErrorCode(code: string): code is ErrorCode {
  return ERROR_CAUSES.some((cause) => cause.code === code);
}

/** 按 code 直查错因定义；未知 code 返回 null，调用方须判空 */
export function findErrorCause(code: string): ErrorCauseDef | null {
  return ERROR_CAUSES.find((cause) => cause.code === code) ?? null;
}
