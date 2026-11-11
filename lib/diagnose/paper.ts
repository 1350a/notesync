/**
 * 整卷诊断四步流程的核心纯函数（wip-agent-workflow.md §5）
 *
 * ① 切题（1 次调用，结构化输出）→ ② 分类（本地规则，零 token）→
 * ③ 同类共享诊断（按错因种类数计调用）→ ④ 汇总（1 次调用）。
 * 分类用关键词规则实现（嵌入聚类挂账：嵌入引擎是浏览器端 worker，服务端用不了）；
 * 规则表属 D 级，实测可调。
 * 降级语义（§5.2）：切题失败不静默继续——提示改用手动分题或单题模式，宁可少做不可错做。
 */
import type { ErrorCode } from './error-causes.ts';
import type { DiagnosisResult } from './types.ts';

/** 切题产物：一道题的最小表示 */
export interface PaperQuestion {
  /** 题号（原卷编号，缺省时按序生成） */
  number: string;
  /** 题干（含小问） */
  stem: string;
  /** 学生作答（切题能识别就带上，识别不出留空） */
  answer?: string;
  /** 题型（选择/填空/解答…，仅透传展示） */
  type?: string;
}

/** 宽松 JSON 解析：剥 markdown 围栏、截取首尾花括号（模型输出常带围栏或前后缀） */
export function parseJsonLoose(raw: string): unknown | null {
  const stripped = raw.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.search(/[[{]/);
  if (start < 0) return null;
  const openChar = stripped[start];
  const closeChar = openChar === '[' ? ']' : '}';
  const end = stripped.lastIndexOf(closeChar);
  if (end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 解析切题结果：数组、每项有非空 stem 即算有效；题号缺失按序补「第N题」。
 * 无有效题目 → null（调用方走 §5.2 降级提示，不静默继续）。
 */
export function parseSplitResult(raw: string): PaperQuestion[] | null {
  const parsed = parseJsonLoose(raw);
  if (!Array.isArray(parsed)) return null;
  const questions: PaperQuestion[] = [];
  parsed.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const stem = typeof record.stem === 'string' ? record.stem.trim() : '';
    if (!stem) return;
    questions.push({
      number: typeof record.number === 'string' && record.number.trim() ? record.number.trim() : `第${index + 1}题`,
      stem: stem.slice(0, 2000),
      answer: typeof record.answer === 'string' && record.answer.trim() ? record.answer.trim().slice(0, 1000) : undefined,
      type: typeof record.type === 'string' && record.type.trim() ? record.type.trim().slice(0, 20) : undefined,
    });
  });
  return questions.length > 0 ? questions : null;
}

/** 分类关键词表（首条命中即归组；D 级实测可调；嵌入聚类挂账） */
export const CLASSIFY_KEYWORDS: ReadonlyArray<readonly [ErrorCode, readonly string[]]> = [
  ['case_miss', ['分类讨论', '分情况', '不同情况', '漏解', '漏了']],
  ['hidden_cond', ['定义域', '分母', '根号', '判别式', '取值范围', '隐含']],
  ['formula_misuse', ['公式', '定理', '法则', '求根']],
  ['calc_error', ['计算', '移项', '约分', '去括号', '通分', '化简']],
  ['boundary_error', ['端点', '取等', '开区间', '闭区间', '不等号', '方向']],
  ['graph_misread', ['图象', '图像', '交点', '顶点', '单调', '读图']],
  ['unit_error', ['单位', '厘米', '千米', '千克', '量纲']],
  ['concept_confuse', ['概念', '定义', '区别', '辨析']],
  ['modeling_error', ['应用题', '实际', '列式', '方案']],
  ['misread', ['审题', '看错', '问的是']],
  ['step_jump', ['跳步', '依据']],
];

/** 无法归组的题目共用一组，仍走一次共享诊断 */
export const GENERAL_GROUP: ErrorCode | 'general' = 'general';

/** 本地分类（零 token）：stem+answer 命中关键词表的第一个 code；全不中入 general 组 */
export function classifyQuestions(questions: PaperQuestion[]): Array<{ code: ErrorCode | 'general'; questions: PaperQuestion[] }> {
  const groups = new Map<ErrorCode | 'general', PaperQuestion[]>();
  for (const question of questions) {
    const haystack = `${question.stem} ${question.answer ?? ''}`;
    const hit = CLASSIFY_KEYWORDS.find(([, words]) => words.some((word) => haystack.includes(word)));
    const code = hit?.[0] ?? GENERAL_GROUP;
    const bucket = groups.get(code) ?? [];
    bucket.push(question);
    groups.set(code, bucket);
  }
  return [...groups.entries()].map(([code, groupQuestions]) => ({ code, questions: groupQuestions }));
}

/** ① 切题提示词：要求只输出 JSON 数组（低任务密度，题干保真、不解题） */
export function buildSplitPrompt(): string {
  return [
    '你是试卷切题器。从材料中把每一道题切分出来，只输出 JSON 数组，不要输出任何其他内容。',
    '每项形如 {"number":"题号","stem":"题干原文（含小问，保真转写）","answer":"学生作答（有则转写，无则省略）","type":"题型"}。',
    '不要解题、不要批改、不要遗漏小题；材料里没有学生作答的题省略 answer 字段。',
  ].join('\n');
}

/** ③ 共享诊断提示词：同组只诊断一次，产出与单题 submit_diagnosis 相同结构的 JSON */
export function buildGroupDiagnosePrompt(input: {
  code: ErrorCode | 'general';
  representative: PaperQuestion;
  members: PaperQuestion[];
  hasStudentAnswer: boolean;
}): string {
  const memberList = input.members.map((q) => `- ${q.number}：${q.stem}`).join('\n');
  return [
    `你是错因诊断器。以下 ${input.members.length} 道题被预分组为同一类错因（组别：${input.code}），`,
    '请以代表题为主做一次错因归因，结论适用于全组。',
    '',
    `代表题 ${input.representative.number}：${input.representative.stem}`,
    input.representative.answer ? `学生作答：${input.representative.answer}` : '（无学生作答）',
    '',
    '同组题目：',
    memberList,
    '',
    '只输出一个 JSON 对象，字段：',
    '{ "level":"L1|L2", "knowledgePoints":["考点，1~3条"],',
    '  "errorCause":{"code":"错因code","confidence":0~1} 或 null（L1 时为 null）,',
    '  "secondaryErrorCause":同上 或省略, "hints":[{"level":1,"content":"..."}], "notes":"备注 或省略" }',
    input.hasStudentAnswer
      ? '有学生作答：输出 L2 归因；正文须锚定作答内容（JSON 内 notes 简述引用了什么）。'
      : '无学生作答：输出 L1 题目画像（errorCause 为 null），不硬编错因。',
    '错因 code 只能取自：misread/pure_guess/calc_error/transcribe/concept_confuse/formula_misuse/hidden_cond/case_miss/step_jump/modeling_error/boundary_error/graph_misread/unit_error/answer_off_target。',
    '不要输出完整解题过程；不要输出 JSON 以外的任何内容。',
  ].join('\n');
}

/** ④ 汇总提示词：逐题引用共享结论 + 全局统计（一次调用） */
export function buildSummaryPrompt(conclusions: Array<{ code: ErrorCode | 'general'; result: DiagnosisResult; members: PaperQuestion[] }>): string {
  const lines = conclusions.flatMap((conclusion) =>
    conclusion.members.map((q) => `- ${q.number}（组别 ${conclusion.code}）：主错因 ${conclusion.result.errorCause?.code ?? '无（L1 画像）'}，考点 ${conclusion.result.knowledgePoints.join('、') || '未给出'}`),
  );
  return [
    '你是诊断汇总器。以下是一次整卷诊断中每题的结论（同类题共享一次诊断），',
    '输出一份 Markdown 汇总：先给全局统计（各错因几题、最集中的问题），再逐题一行引用结论，',
    '最后给三条最优先的改进建议。不要重新解题，不要输出超过 400 字。',
    '',
    ...lines,
  ].join('\n');
}
