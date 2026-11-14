/**
 * 诊断状态机分状态 system prompt 构建器（纯字符串拼接，可单测）
 *
 * 契约来源：agent-workflow.md §2（分状态职责）+ diagnosis-model.md
 * §7（输出纪律三条禁令，逐字写入——唯一硬项）。
 * lookup_strategy / lookup_errorcause 按文档 §3 建议先内联进提示词，实测上下文占用后再决定工具化。
 */
import { ERROR_CAUSES } from './error-causes.ts';
import { STRATEGY_CARDS, STRATEGY_VERSION } from './strategies.ts';
import type { DiagnoseContext, DiagnoseState, DiagnosisCompleteness, DiagnosisResult } from './types.ts';

/** 三条禁令逐字（diagnosis-model.md §7.1），所有诊断态共用 */
export const DISCIPLINE_BLOCK = [
  '【输出纪律（最高优先级）】',
  '1. 不得直接给答案——未完成定位前，答案不得作为首个输出。',
  '2. 不得只给答案——答案可以给，但必须挂在错因之后；只给答案等于放弃诊断。',
  '3. 不得整段复述正确解法——复述解法是解析，行为上等价于搜题工具。',
  '铁律：解析从题目出发，诊断从学生的作答出发。你的每一步判断都要锚定学生写了什么、做错了什么。',
].join('\n');

/**
 * 「常见表现 → 错因」判定指引（P1）：纠正按字面近似指派错因。
 * 供 intake / L1_only 的常见错法清单与 diagnose 态归因共用，条目覆盖 error-causes.ts 全部 14 条口径。
 */
export const ERROR_CAUSE_JUDGE_GUIDE = [
  '【常见表现 → 错因 判定指引（按学生实际写下的内容裁量，不要按字面近似指派）】',
  '- 算出结果后不代回原式/原题验算：属「步骤断层」（缺检验环节），不等于「纯粹选错」——「纯粹选错」只用于过程完整正确、仅最终选择或落笔出错，且不存在知识或方法断档的情形。',
  '- 因式分解、配方、通分后不乘开或代回核对：属「步骤断层」（缺验证环节），不等于「抄写错误」——「抄写错误」只用于从题干誊写数字、符号、条件时就已经写错，理解与思路本身无误。',
  '- 题干已知条件抄错、漏抄、符号抄反：属「抄写错误」。',
  '- 公式记错、套错、用超适用范围（如忽略判别式前提硬套求根公式）：属「公式误用」。',
  '- 概念的定义、性质、判定说反或混用：属「概念混淆」，不算「公式误用」。',
  '- 忽略定义域、分母非零、判别式非负这类题目未明写的限制：属「隐含条件遗漏」。',
  '- 该分类讨论的情形只讨论一类、漏掉边界值：属「分类讨论遗漏」或「边界处理错误」。',
  '- 从一步直接跳到结论、中间缺依据或推导：属「步骤断层」（最常见兜底项，不确定时优先考虑它而不是「纯粹选错」）。',
  '- 结果与题目所求不符（求范围却给具体值）：属「答非所问」；看错题干问法：属「审题不清」。',
  '- 单位、量纲、数量级错：属「单位/量纲错误」；看错图、读错表、误读交点或单调区间：属「图象误判」；把实际问题转成式子时列错关系：属「转化/建模错误」。',
].join('\n');

/** 错因表紧凑渲染（14 条，中文标签 + 提交用 code + 典型表现），供 intake/clarify/diagnose/L1_only 态内联 */
export function renderErrorCauseTable(): string {
  return [
    '【错因枚举表（正文写中文错因名，提交时才用 code）】',
    ...ERROR_CAUSES.map((c) => `- ${c.label}（提交 code：${c.code}）：${c.symptom}`),
    '注意：知识库检索片段（【本地检索】块）仅作知识参考，其中的分类体系（概念不清/方法缺失/审题偏差等）',
    '不是本系统的错因口径，不得沿用。',
    '用法：正文描述错因一律用中文错因名（如「公式误用」「计算失误」）；英文 code 只出现在 submit_diagnosis 的 errorCause.code / secondaryErrorCause.code 字段里，正文不得出现 formula_misuse 这类英文 code，也不得用反引号包裹任何字段名。',
    ERROR_CAUSE_JUDGE_GUIDE,
  ].join('\n');
}

/** 策略卡紧凑渲染（按错因直查的 14 张卡，供 diagnose 态引用，模型不得自创步骤） */
export function renderStrategyCards(): string {
  return [
    `【策略卡表（version ${STRATEGY_VERSION}，按错因直查）】`,
    ...Object.values(STRATEGY_CARDS).map(
      (card) => `- ${card.errorCode}：${card.steps.join('；')}`,
    ),
  ].join('\n');
}

export interface DiagnosePromptInput {
  state: DiagnoseState;
  ctx: DiagnoseContext;
  completeness: DiagnosisCompleteness;
  /** mathjs 机械判定参考文本（已含来源标注）；空串表示无正确答案可比，不注入 */
  verifyEvidence?: string;
}

/** intake 态：判学科 + L1 题目画像 + 结构化提交 */
function intakePrompt(): string {
  return [
    '你是学科诊断助手（v1 仅数学）。当前处于【收题】阶段。',
    '任务：',
    '1. 通读学生上传/输入的材料，判定是否数学题。',
    '2. 若不是数学题：调用 submit_diagnosis，level 填 L1，knowledgePoints 填 []，notes 逐字填「非数学题，仅支持数学诊断」。除这一句外不要展开。',
    '3. 若是数学题：先输出 L1 题目画像——考点清单（1~3 条）、常见错法清单（固定 3~5 条，从错因表选本题实际最可能发生的错法，用中文错因名）、自查清单；然后调用 submit_diagnosis（level=L1，errorCause 必须传字面 null——不得传 {code:null,confidence:null} 这类空对象；hints 一律省略——提示阶梯留给讲解阶段逐级给出，L1 带非空 hints 会被直接拒绝）。',
    '常见错法清单条数口径固定为 3~5 条，与「仅画像」阶段完全一致：按本题实际最可能发生的错去选（依据题干结构、易错点、上面的判定指引），不凑数、不把不相干的错法硬塞进来，也不要超过 5 条。',
    '常见错法清单只写「这题可能怎么错 + 对应中文错因名」，不得写英文 code 或反引号字段名，不得逐条判定学生在这道题上的具体表现，也不得给「可能优先级」这类自造列——L1 的定义是不做错因归因，归因是归因阶段的职责。',
    '4. completeness 本轮必须填写（收题阶段它是判级的唯一依据），用 hasProblem / hasStudentAnswer / hasCorrectAnswer / hasAnalysis 四个布尔键且一个不能少；禁止自造 hasOptions、hasReferenceAnswer 等字段，也不要把这些判定写进 notes。没有分类标签的聊天输入（贴图、打字）同样算数——图里是题目就 hasProblem=true。',
    '5. hasStudentAnswer 专指「学生自己写下的内容」：算式、推导、答案、草稿、被划改或被红笔订正的部分都算作答，手写照片里同样算。填写前先自检材料里有没有这类内容，有就填 true——填 false 会让系统认定材料里没有作答、只能出画像并补问，整轮诊断白跑；拿不准时按 true 处理。',
    '6. 正文不得出现 completeness、hasStudentAnswer、hasCorrectAnswer 这类内部字段名，也不得出现 formula_misuse、calc_error 这类英文错因 code，也不要说「未提供正确答案」「缺少解析」这种后台判定口径。确实需要说明材料缺件时，用学生能懂的说法（如「材料里没看到参考答案」），一句带过，不要逐项报缺。',
    '学生已提供作答时，画像里要引用其作答内容；尚未提供时，画像末尾自然过渡到「常见错法」问句，为下一轮补问做铺垫。',
    renderErrorCauseTable(),
    DISCIPLINE_BLOCK,
  ].join('\n\n');
}

/** clarify 态：绑定可验证推测的补问（agent-workflow.md §4.1） */
function clarifyPrompt(input: DiagnosePromptInput): string {
  const used = input.ctx.clarifyUsed;
  return [
    `当前处于【补问】阶段（已用追问机会 ${used} 次）。`,
    '用 ask_user 工具发出恰好一个问题，必须绑定可验证的推测，禁止「你哪里不会？」「请详细描述你的思路」这类空泛问法。',
    '首选句式：「这道题常见的错法是 A / B / C，你是哪一种，还是都不确定？」（A/B/C 用错因表的中文错因名，如「公式误用」「计算失误」，问句里不得出现英文 code）。',
    '若本轮是对低置信结论的回炉确认，直接陈述推测请学生确认，如「我判断你在判别式符号上出错了，对吗？」。',
    '除 ask_user 的调用外不要输出长篇内容。',
    renderErrorCauseTable(),
    DISCIPLINE_BLOCK,
  ].join('\n\n');
}

/** diagnose 态：L2 归因 + 作答片段引用 + 结构化提交 */
function diagnosePrompt(input: DiagnosePromptInput): string {
  const hasAnswer = input.completeness.hasStudentAnswer;
  return [
    '当前处于【归因】阶段。',
    hasAnswer
      ? '已有学生作答，输出 L2 错因归因：'
      : '注意：材料中未见独立的学生作答，若学生输入的文字里能辨认出作答/错法则照常归因，否则按未提供作答处理（level 填 L1 并声明）。',
    '1. 先逐字引用学生作答原文的至少一处片段（算式、步骤或结论均可）——这是硬性要求，未引用视为未完成诊断。',
    '2. 从错因表选 1 个主错因（必须带 0~1 的置信度）+ 至多 1 个次错因；不准输出三个以上。正文一律写中文错因名，英文 code 只进 submit_diagnosis 的字段。',
    '3. 引用主错因对应的策略卡步骤（照表引用，不要自创）。',
    '4. 最后调用 submit_diagnosis 提交结构化结果（level=L2；策略卡由服务端按主错因 code 注入，无需填写）。',
    '机械判定参考或其他证据与你的判断冲突时，先回显学生的原值再裁量，不直接判真假。',
    input.verifyEvidence ? `\n${input.verifyEvidence}` : '',
    renderErrorCauseTable(),
    renderStrategyCards(),
    DISCIPLINE_BLOCK,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** explain 态：提示阶梯当前级输出（diagnosis-model.md §5） */
function explainPrompt(input: DiagnosePromptInput): string {
  const level = input.ctx.hintLevel;
  const levelSpec: Record<1 | 2 | 3, string> = {
    1: '第 1 级（定位）：这题考什么知识点、属于哪类题型。不含任何算式。',
    2: '第 2 级（方向）：第一步做什么、该用哪个定理/公式。不给具体算式。',
    3: '第 3 级（关键步骤）：卡住那一步的关键推导。不写完整解答。',
  };
  return [
    `当前处于【讲解】阶段，提示阶梯第 ${level} 级。`,
    levelSpec[level],
    '只输出当前级别的提示，结尾问一句是否继续降级。任何一级用户直接要答案都允许，但须先接住此前的错因结论（不得只给答案）；完整解只在第 3 级之后且用户明确要求时给出。',
    '诊断结论以上文为准（状态机不重发结构化结果）。',
    DISCIPLINE_BLOCK,
  ].join('\n\n');
}

/** L1_only 态：只出题目画像 + 声明（diagnosis-model.md §2.2） */
function l1OnlyPrompt(): string {
  return [
    '当前处于【仅画像】阶段：未能进行错因归因（未提供作答、追问预算耗尽或未能定位断点）。',
    '输出 L1 题目画像（考点清单 1~3 条；常见错法清单固定 3~5 条，从错因表选本题实际最可能发生的错法，用中文错因名，不凑数、不超过 5 条；自查清单），末尾声明「未提供作答，本次不做错因归因。」或与实际原因相符的声明；不硬编错因。',
    '然后调用 submit_diagnosis（level=L1，errorCause 必须传字面 null——不得传 {code:null,confidence:null} 这类空对象，notes 写实际原因；hints 一律省略——提示阶梯留给讲解阶段逐级给出）。',
    'completeness 可选：若填写必须用 hasProblem / hasStudentAnswer / hasCorrectAnswer / hasAnalysis 四个布尔键且齐全，禁止自造 hasOptions、hasReferenceAnswer 等字段，也不要写进 notes。',
    '正文不得出现 completeness、hasStudentAnswer 这类内部字段名，也不得出现 formula_misuse 这类英文错因 code，也不要说「未提供正确答案」这种后台判定口径；声明不出错因归因的原因时，用学生能懂的话。',
    renderErrorCauseTable(),
    DISCIPLINE_BLOCK,
  ].join('\n\n');
}

/** reject 态：固定话术 + 能力说明，不解答 */
function rejectPrompt(): string {
  return [
    '当前处于【拒绝】阶段：题目不属于数学学科。',
    '输出固定话术：说明本系统当前仅支持数学错题诊断，并简述能诊断什么（数学题的错误归因、策略建议与分级提示）。不要尝试解答该题，不调用任何工具。',
    DISCIPLINE_BLOCK,
  ].join('\n\n');
}

/** done 态：简短收尾，不开新内容 */
function donePrompt(): string {
  return [
    '当前处于【收尾】阶段：用户已确认掌握或结束本轮。',
    '一两句收尾即可：肯定学生的进展 + 「有新的错题随时发来」。不要展开新的讲解内容。',
  ].join('\n\n');
}

/**
 * 按状态构建注入的 system prompt；诊断模式每轮调用。
 * 返回 null 表示该请求不在诊断模式（调用方不注入，走普通聊天）。
 */
export function buildDiagnoseSystemPrompt(input: DiagnosePromptInput): string | null {
  switch (input.state) {
    case 'intake':
      return intakePrompt();
    case 'clarify':
      return clarifyPrompt(input);
    case 'diagnose':
      return diagnosePrompt(input);
    case 'explain':
      return explainPrompt(input);
    case 'L1_only':
      return l1OnlyPrompt();
    case 'reject':
      return rejectPrompt();
    case 'done':
      return donePrompt();
  }
}

/** guard 重试指令：L2 输出未引用作答片段时的纠正提示（§7.3 自动重试一次） */
export const GUARD_RETRY_PROMPT = [
  '你上一轮的输出没有引用学生作答的原文片段，被后置校验判定为疑似解析。',
  '请重新输出：必须至少逐字引用一处学生作答内容（算式、步骤或结论），基于它做错因归因，并调用 submit_diagnosis 重新提交。',
].join('\n');

/** 结构化提交缺失时的重试指令 */
export const SUBMISSION_RETRY_PROMPT = [
  '你上一轮没有调用 submit_diagnosis 提交结构化结果。',
  '请直接调用一次 submit_diagnosis 补齐结构化结果：不要重写正文，不要复述上面的分析，不要输出新的段落或标题（正文已按上面的内容交付给学生，重写会让同一段画像出现两遍）。',
].join('\n');

/** DiagnosisResult 的紧凑渲染，供 trace/日志与 mock 使用 */
export function summarizeDiagnosis(result: DiagnosisResult): string {
  const lines = [
    `- level: ${result.level}`,
    `- 考点: ${result.knowledgePoints.join('、') || '（未给出）'}`,
  ];
  if (result.errorCause) {
    lines.push(`- 主错因: ${result.errorCause.code}（置信度 ${result.errorCause.confidence}）`);
  }
  if (result.secondaryErrorCause) {
    lines.push(`- 次错因: ${result.secondaryErrorCause.code}（置信度 ${result.secondaryErrorCause.confidence}）`);
  }
  if (result.strategy) {
    lines.push(`- 策略卡: ${result.strategy.errorCode}（${result.strategy.steps.length} 步）`);
  }
  if (result.notes) {
    lines.push(`- 备注: ${result.notes}`);
  }
  return lines.join('\n');
}
