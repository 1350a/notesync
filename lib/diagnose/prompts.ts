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

/** 错因表紧凑渲染（14 条，code + 标签 + 典型表现），供 intake/diagnose 态内联 */
export function renderErrorCauseTable(): string {
  return [
    '【错因枚举表（只能从中选 code）】',
    ...ERROR_CAUSES.map((c) => `- ${c.code}（${c.label}）：${c.symptom}`),
    '注意：知识库检索片段（【本地检索】块）仅作知识参考，其中的分类体系（概念不清/方法缺失/审题偏差等）',
    '不是本系统的错因口径，正文与提交一律使用上表 code，不得混用。',
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
    '3. 若是数学题：先输出 L1 题目画像——考点清单（1~3 条）、常见错法清单（从错因表选 2~4 条最可能的，引用 code）、自查清单；然后调用 submit_diagnosis（level=L1，errorCause 必须传字面 null——不得传 {code:null,confidence:null} 这类空对象；hints 一律省略——提示阶梯留给讲解阶段逐级给出，L1 带非空 hints 会被直接拒绝）。',
    '常见错法清单只写「这题可能怎么错 + 对应 code」，不得逐条判定学生在这道题上的具体表现，也不得给「可能优先级」这类自造列——L1 的定义是不做错因归因，归因是归因阶段的职责。',
    '4. completeness 是可选的对象字段，一旦填写必须用 hasProblem / hasStudentAnswer / hasCorrectAnswer / hasAnalysis 四个布尔键且一个不能少；禁止自造 hasOptions、hasReferenceAnswer 等字段，也不要把这些判定写进 notes。四布尔按材料实际具备情况如实填写：没有分类标签的聊天输入（贴图、打字）也算数——图里是题目就 hasProblem=true，文字/图里看得出学生作答就 hasStudentAnswer=true。',
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
    '首选句式：「这道题常见的错法是 A / B / C，你是哪一种，还是都不确定？」（A/B/C 引用错因表 code 与标签）。',
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
    '2. 从错因表选 1 个主错因（必须带 0~1 的置信度）+ 至多 1 个次错因；不准输出三个以上。',
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
    '输出 L1 题目画像（考点清单、常见错法清单、自查清单），末尾声明「未提供作答，本次不做错因归因。」或与实际原因相符的声明；不硬编错因。',
    '然后调用 submit_diagnosis（level=L1，errorCause 必须传字面 null——不得传 {code:null,confidence:null} 这类空对象，notes 写实际原因；hints 一律省略——提示阶梯留给讲解阶段逐级给出）。',
    'completeness 可选：若填写必须用 hasProblem / hasStudentAnswer / hasCorrectAnswer / hasAnalysis 四个布尔键且齐全，禁止自造 hasOptions、hasReferenceAnswer 等字段，也不要写进 notes。',
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
  '请基于你上面的分析补调用一次 submit_diagnosis（不要重复长篇正文）。',
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
