/**
 * 诊断模式请求侧运行时（服务端）
 *
 * 职责：payload 严格解析、客户端事件应用、submit_diagnosis 提交校验与结果组装、
 * 响应后状态推进与重试编排。route.ts 只做校验与委托，编排逻辑全部收在本文件。
 *
 * 设计口径：
 * - 上下文由客户端持久回传（服务端无会话），解析从严——脏数据一律回落初始 intake，不抛错；
 * - 事件白名单：只有「模型调用前就能确定」的事件允许客户端上报（clarify_done/hint_descend/mastered/user_stop），
 *   intake_done/diagnosis_done/output_done 由服务端在响应后自行推导，客户端不得伪造；
 * - completeness 以服务端从附件推导的结果为准，模型提交里的同名内容一律丢弃。
 */
import type { ProviderMessage } from '../provider/types.ts';
import { deriveCompleteness } from './completeness.ts';
import { isKnownErrorCode } from './error-causes.ts';
import { checkAnswerQuote } from './guard.ts';
import { GUARD_RETRY_PROMPT, SUBMISSION_RETRY_PROMPT } from './prompts.ts';
import { createInitialContext, transition } from './state-machine.ts';
import { findStrategyCard, STRATEGY_VERSION } from './strategies.ts';
import type {
  DiagnoseAttachment,
  DiagnoseContext,
  DiagnoseRequestEvent,
  DiagnoseState,
  DiagnosisCompleteness,
  DiagnosisResult,
  ErrorCauseRef,
  HintStep,
} from './types.ts';
import { verifyAnswerEquivalence } from './verify.ts';

/** 主错因置信度达标线（A 级假设，实测可调） */
export const CONFIDENCE_THRESHOLD = 0.7;

const STATES = new Set<DiagnoseState>(['intake', 'clarify', 'diagnose', 'explain', 'L1_only', 'reject', 'done']);

/** 客户端回传上下文严格解析：任一字段非法 → null（调用方回落初始 intake 重新收题） */
export function parseDiagnoseContext(raw: unknown): DiagnoseContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.subject !== 'math') return null; // v1 仅数学；未知学科视为脏数据
  if (typeof record.state !== 'string' || !STATES.has(record.state as DiagnoseState)) return null;
  if (
    typeof record.clarifyUsed !== 'number' ||
    !Number.isInteger(record.clarifyUsed) ||
    record.clarifyUsed < 0 ||
    record.clarifyUsed > 2
  ) {
    return null;
  }
  if (record.hintLevel !== 1 && record.hintLevel !== 2 && record.hintLevel !== 3) return null;
  return {
    subject: 'math',
    state: record.state as DiagnoseState,
    clarifyUsed: record.clarifyUsed,
    hintLevel: record.hintLevel,
  };
}

/** 客户端事件严格解析：白名单外一律 null（不报错，按未携带处理） */
export function parseDiagnoseEvent(raw: unknown): DiagnoseRequestEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  switch (record.type) {
    case 'clarify_done':
      if (typeof record.hasAnswer !== 'boolean' || typeof record.refused !== 'boolean') return null;
      return { type: 'clarify_done', hasAnswer: record.hasAnswer, refused: record.refused };
    case 'hint_descend':
    case 'mastered':
    case 'user_stop':
      return { type: record.type };
    default:
      return null;
  }
}

/** 一次诊断会话快照：payload 解析 + 客户端事件应用后的本轮入口状态 */
export interface DiagnoseSession {
  context: DiagnoseContext;
  completeness: DiagnosisCompleteness;
}

/**
 * 解析请求体 diagnose 字段并应用客户端事件。
 * 返回 null 表示本请求不在诊断模式（普通聊天）；payload 是对象即算激活，
 * 上下文脏数据回落初始 intake（重新收题比带着伪造状态跑更安全）。
 */
export function resolveDiagnoseSession(payloadRaw: unknown, attachments: DiagnoseAttachment[]): DiagnoseSession | null {
  if (!payloadRaw || typeof payloadRaw !== 'object') return null;
  const record = payloadRaw as Record<string, unknown>;
  let context = parseDiagnoseContext(record.context) ?? createInitialContext();

  const event = parseDiagnoseEvent(record.event);
  if (event) {
    const outcome = transition(context, event);
    if (outcome.accepted) {
      context = outcome.context;
    } else {
      // 事件与状态不匹配（如 done 后还发 mastered）：忽略，按当前状态继续
      console.warn(`[diagnose] 忽略与状态 ${context.state} 不匹配的客户端事件 ${event.type}`);
    }
  }
  return { context, completeness: deriveCompleteness(attachments) };
}

// ---------------------------------------------------------------------------
// submit_diagnosis 提交的严格解析与结果组装
// ---------------------------------------------------------------------------

/** 模型提交经严格校验后的形态 */
export interface ParsedSubmission {
  isMath: boolean;
  level: 'L1' | 'L2';
  knowledgePoints: string[];
  errorCause: ErrorCauseRef | null;
  secondaryErrorCause?: ErrorCauseRef;
  hints: HintStep[];
  notes?: string;
}

export type SubmissionParseResult = { ok: true; value: ParsedSubmission } | { ok: false; reason: string };

/** 单条知识点 / 备注 / 提示的长度上限，防模型倾倒长文 */
const MAX_FIELD_CHARS = 200;

function parseCauseRef(raw: unknown): ErrorCauseRef | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: '错因不是对象' };
  const record = raw as Record<string, unknown>;
  if (typeof record.code !== 'string' || !isKnownErrorCode(record.code)) {
    return { error: `错因 code「${String(record.code)}」不在枚举表` };
  }
  const confidence = record.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { error: 'confidence 不是 0~1 的数值' };
  }
  return { code: record.code, confidence: Math.round(confidence * 100) / 100 };
}

/** 提交严格解析：任一硬字段非法整体拒绝（route 会以重试提示让模型补交），不静默降级 */
export function parseSubmission(raw: unknown): SubmissionParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '提交不是对象' };
  const record = raw as Record<string, unknown>;

  const level = record.level;
  if (level !== 'L1' && level !== 'L2') return { ok: false, reason: 'level 必须是 L1 或 L2' };

  if (!Array.isArray(record.knowledgePoints) || record.knowledgePoints.length === 0) {
    return { ok: false, reason: 'knowledgePoints 缺失' };
  }
  const knowledgePoints = record.knowledgePoints
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, MAX_FIELD_CHARS))
    .slice(0, 3);

  let errorCause: ErrorCauseRef | null = null;
  if (record.errorCause != null) {
    const parsed = parseCauseRef(record.errorCause);
    if ('error' in parsed) return { ok: false, reason: `主错因非法：${parsed.error}` };
    errorCause = parsed;
  }
  if (level === 'L2' && !errorCause) {
    return { ok: false, reason: 'L2 提交必须带主错因 errorCause' };
  }
  if (level === 'L1' && errorCause) {
    return { ok: false, reason: 'L1 提交不得带 errorCause（不硬编错因）' };
  }

  let secondaryErrorCause: ErrorCauseRef | undefined;
  if (record.secondaryErrorCause != null) {
    const parsed = parseCauseRef(record.secondaryErrorCause);
    if ('error' in parsed) return { ok: false, reason: `次错因非法：${parsed.error}` };
    secondaryErrorCause = parsed;
  }

  const hints: HintStep[] = [];
  if (Array.isArray(record.hints)) {
    for (const item of record.hints.slice(0, 3)) {
      if (!item || typeof item !== 'object') continue;
      const hint = item as Record<string, unknown>;
      if ((hint.level !== 1 && hint.level !== 2 && hint.level !== 3) || typeof hint.content !== 'string' || !hint.content.trim()) {
        return { ok: false, reason: 'hints 条目必须是 {level: 1|2|3, content}' };
      }
      hints.push({ level: hint.level, content: hint.content.trim().slice(0, MAX_FIELD_CHARS) });
    }
  }

  const notes = typeof record.notes === 'string' && record.notes.trim() ? record.notes.trim().slice(0, MAX_FIELD_CHARS) : undefined;
  const isMath = record.isMath === false ? false : true; // 缺省按数学处理；reject 靠 intake 阶段显式传 false

  return {
    ok: true,
    value: { isMath, level, knowledgePoints, errorCause, secondaryErrorCause, hints, notes },
  };
}

/**
 * 组装最终 DiagnosisResult：completeness 用服务端推导值，策略卡按 code 直查注入（模型不产卡）。
 */
export function buildDiagnosisResult(parsed: ParsedSubmission, completeness: DiagnosisCompleteness): DiagnosisResult {
  return {
    subject: 'math',
    level: parsed.level,
    completeness,
    knowledgePoints: parsed.knowledgePoints,
    errorCause: parsed.level === 'L2' ? parsed.errorCause : null,
    secondaryErrorCause: parsed.level === 'L2' ? parsed.secondaryErrorCause : undefined,
    strategy: parsed.level === 'L2' && parsed.errorCause ? findStrategyCard(parsed.errorCause.code) : null,
    hints: parsed.hints,
    notes: parsed.notes,
    strategyVersion: STRATEGY_VERSION,
  };
}

// ---------------------------------------------------------------------------
// 证据与判据输入
// ---------------------------------------------------------------------------

/** 学生作答来源集合：wrong 类附件正文 + 最新一条用户文字（guard 判据的比对基准） */
export function collectStudentSources(attachments: DiagnoseAttachment[], lastUserText: string): string[] {
  const sources = attachments
    .filter((item) => item.category === 'wrong' && item.text && item.text.trim())
    .map((item) => (item.text as string).trim());
  const typed = lastUserText.trim();
  if (typed) sources.push(typed);
  return sources;
}

/**
 * mathjs 机械判定证据文本：仅当 wrong 与 correct 两类附件都有正文时生成。
 * unverifiable 不注入（无信息量的证据只会稀释提示词）；文案按理念 3 标注来源与冲突处理口径。
 */
export function buildVerifyEvidence(attachments: DiagnoseAttachment[]): string {
  const wrong = attachments.find((item) => item.category === 'wrong' && item.text?.trim())?.text?.trim();
  const correct = attachments.find((item) => item.category === 'correct' && item.text?.trim())?.text?.trim();
  if (!wrong || !correct) return '';
  const verdict = verifyAnswerEquivalence(wrong, correct);
  if (verdict.verdict === 'unverifiable') return '';
  const verdictText = verdict.verdict === 'equivalent' ? '两个答案等价' : '两个答案不等';
  const unitNote = verdict.unitMismatch ? '；数值等价但单位表述不同，注意单位类错因' : '';
  return `【机械判定参考】学生作答「${wrong}」与所给正确答案「${correct}」的确定性比对结果：${verdictText}${unitNote}。（来源：mathjs 机械判定，仅供参考；与学生自述冲突时以学生原值为准，先回显确认再裁量）`;
}

// ---------------------------------------------------------------------------
// 响应后状态推进与重试编排
// ---------------------------------------------------------------------------

export type DiagnosisOutcome = 'confident' | 'low_confidence' | 'guard_failed' | 'l1_fallback';

/** L2 提交的出口三态 + 模型自行降级 L1 的第四态 */
export function resolveOutcome(parsed: ParsedSubmission, guardPassed: boolean): DiagnosisOutcome {
  if (parsed.level === 'L1') return 'l1_fallback';
  if (!guardPassed) return 'guard_failed';
  return (parsed.errorCause?.confidence ?? 0) >= CONFIDENCE_THRESHOLD ? 'confident' : 'low_confidence';
}

/**
 * 响应后推进状态机（服务端推导事件的唯一入口）。
 * 各状态的迁移语义见 state-machine.ts；这里决定「发哪些推导事件」：
 * - intake：按 isMath/hasProblem 定 clarify 或 reject；已有作答时快进 diagnose（省一轮空补问）
 * - diagnose：按 outcome 三态迁移；l1_fallback 视为画像已随本轮交付，直接走完 L1_only→done
 * - L1_only / reject：输出已交付，output_done 收尾
 */
export function advanceAfterResponse(input: {
  context: DiagnoseContext;
  completeness: DiagnosisCompleteness;
  submission: ParsedSubmission;
  outcome: DiagnosisOutcome;
}): DiagnoseContext {
  const { context, completeness, submission, outcome } = input;

  if (context.state === 'intake') {
    // 没有原题连学科都判不了：留在 intake 继续引导（wip-diagnosis-model.md §1.1）
    if (!completeness.hasProblem) return context;
    if (!submission.isMath) {
      const rejected = transition(context, { type: 'intake_done', hasProblem: true, isMath: false }).context;
      return transition(rejected, { type: 'output_done' }).context;
    }
    const clarified = transition(context, { type: 'intake_done', hasProblem: true, isMath: true }).context;
    if (completeness.hasStudentAnswer) {
      // 已有作答：clarify 形同虚设，快进 diagnose（迁移仍走状态机，不私设捷径）
      return transition(clarified, { type: 'clarify_done', hasAnswer: true, refused: false }).context;
    }
    return clarified;
  }

  if (context.state === 'diagnose') {
    if (outcome === 'l1_fallback') {
      // 模型自行判定无作答可归因：画像内容已随本轮输出交付，走完降级收尾
      const l1 = transition(context, { type: 'diagnosis_done', outcome: 'guard_failed' }).context;
      return transition(l1, { type: 'output_done' }).context;
    }
    return transition(context, { type: 'diagnosis_done', outcome }).context;
  }

  if (context.state === 'L1_only' || context.state === 'reject') {
    return transition(context, { type: 'output_done' }).context;
  }

  // explain / clarify / done：无服务端推导事件，等待下一轮客户端事件
  return context;
}

/** 单次 loop 运行的摘要（route 的 pump 回填，runtime 不碰流本身） */
export interface LoopRunResult {
  /** 本段新增的正文全文（guard 判据的比对对象） */
  outputText: string;
  done: { usedRounds: number; finishReason: string } | null;
  awaitingUser: boolean;
  /** error 事件已由 route 转发；失败后不再编排重试 */
  failed: boolean;
}

export interface FinalizeInput {
  session: DiagnoseSession;
  /** 本轮已组装的完整消息（含诊断 system prompt），重试请求在其上追加 */
  baseMessages: ProviderMessage[];
  /** 主循环运行结果 */
  mainRun: LoopRunResult;
  attachments: DiagnoseAttachment[];
  /** submit_diagnosis 工具绑定的存储（最后一次提交生效） */
  submissionStore: { args: Record<string, unknown> | null };
  lastUserText: string;
  /** 由 route 提供：跑一次工具循环并转发流（重试段内容对用户可见） */
  runLoop: (messages: ProviderMessage[]) => Promise<LoopRunResult>;
}

export interface FinalizeResult {
  context: DiagnoseContext;
  /** 最终结构化结果；null 表示本轮没有可交付的诊断（提交缺失/校验失败/guard 两试不过） */
  diagnosis: DiagnosisResult | null;
  guardPassed: boolean;
  retried: 'submission' | 'guard' | null;
}

/** 必须以 submit_diagnosis 收尾的状态；缺提交自动补一次（协议重试，不耗追问预算） */
const NEEDS_SUBMISSION: ReadonlySet<DiagnoseState> = new Set(['intake', 'diagnose', 'L1_only']);

/**
 * 响应后编排：提交补交重试 → guard 引用判据（含一次重试）→ 组装结果 → 状态推进。
 * 任何失败都不抛错：诊断是增益路径，坏结果宁可不给（diagnosis=null）也不给假错因。
 */
export async function finalizeDiagnosis(input: FinalizeInput): Promise<FinalizeResult> {
  const { session, baseMessages, mainRun, attachments, submissionStore, lastUserText, runLoop } = input;
  let context = session.context;
  let retried: FinalizeResult['retried'] = null;
  let outputText = mainRun.outputText;
  let guardPassed = true;

  // ① 该交没交：带上下文补一次（模型看得见自己刚输出的内容）
  if (!submissionStore.args && NEEDS_SUBMISSION.has(context.state) && !mainRun.failed) {
    retried = 'submission';
    const run = await runLoop([
      ...baseMessages,
      { role: 'assistant', content: outputText },
      { role: 'system', content: SUBMISSION_RETRY_PROMPT },
    ]);
    outputText += run.outputText;
  }

  let diagnosis: DiagnosisResult | null = null;
  const submission = submissionStore.args;
  if (!submission) {
    // 两轮都不交：上下文原地不动，下一轮请求自然重试；不硬编结果
    return { context, diagnosis: null, guardPassed, retried };
  }

  const parsed = parseSubmission(submission);
  if (!parsed.ok) {
    console.warn(`[diagnose] 提交校验失败：${parsed.reason}`);
    return { context, diagnosis: null, guardPassed, retried };
  }

  diagnosis = buildDiagnosisResult(parsed.value, session.completeness);

  // ② guard：diagnose 态的 L2 必须引用作答原文（§7.3，重试一次不耗追问预算）
  if (context.state === 'diagnose' && parsed.value.level === 'L2') {
    const sources = collectStudentSources(attachments, lastUserText);
    if (sources.length > 0) {
      guardPassed = checkAnswerQuote({ output: outputText, studentSources: sources }).quoted;
      if (!guardPassed) {
        retried = 'guard';
        const run = await runLoop([
          ...baseMessages,
          { role: 'assistant', content: outputText },
          { role: 'system', content: GUARD_RETRY_PROMPT },
        ]);
        outputText += run.outputText;
        const resubmission = submissionStore.args;
        const reparsed = resubmission ? parseSubmission(resubmission) : null;
        if (reparsed?.ok) {
          guardPassed = checkAnswerQuote({ output: outputText, studentSources: sources }).quoted;
          if (guardPassed) diagnosis = buildDiagnosisResult(reparsed.value, session.completeness);
        } else {
          guardPassed = false;
        }
        if (!guardPassed) {
          // 两试不过：本次 L2 不交付（疑似解析），降级路径交给状态机（下一轮 L1_only 输出画像）
          diagnosis = null;
        }
      }
    }
  }

  const outcome = resolveOutcome(parsed.value, guardPassed);
  context = advanceAfterResponse({
    context,
    completeness: session.completeness,
    submission: parsed.value,
    outcome,
  });
  return { context, diagnosis, guardPassed, retried };
}
