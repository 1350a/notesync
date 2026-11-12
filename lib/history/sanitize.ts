/**
 * 落库数据的清洗与兜底（doc/chat-history.md §4）。
 *
 * 存储层面对的是上一版本写下的、或已损坏的数据，任何一条脏记录都不允许让
 * loadSession 抛错、也不允许污染其余会话。清洗口径一律「尽力保留 + 保位不压缩」：
 * 图片槽位宁可置空串也不删下标，否则后续 blob key 会整体错位串台。
 */
import { MAX_DATA_URL, parseTextFiles } from '../chat/messages.ts';
import type { ToolCallView } from '../chat/messages.ts';
import type { AskUserQuestion } from '../tools/types.ts';
import type {
  DiagnosisResult,
  ErrorCauseRef,
  HintStep,
  StrategyCard,
} from '../diagnose/types.ts';
import { isKnownErrorCode } from '../diagnose/error-causes.ts';
import { normalizeTitle } from './title.ts';
import { MAX_IMAGES_PER_MESSAGE, MAX_MESSAGE_CHARS, UNTITLED_SESSION } from './types.ts';
import type {
  ExpiredImageRef,
  HistoryMessage,
  SessionMeta,
  SessionRecord,
} from './types.ts';

/** 截断超长正文；非字符串一律按空串处理 */
function sanitizeText(raw: unknown, limit: number): string {
  if (typeof raw !== 'string') return '';
  return raw.length > limit ? raw.slice(0, limit) : raw;
}

/**
 * 清洗图片槽位：保留下标，非法项置空串。
 * 空串是「过期/缺失」的通用标记，上行时被 lib/chat/messages.ts 天然过滤。
 */
export function sanitizeImageSlots(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const slots = raw.slice(0, MAX_IMAGES_PER_MESSAGE);
  return slots.map((item) =>
    typeof item === 'string' && item.startsWith('data:image/') && item.length <= MAX_DATA_URL
      ? item
      : ''
  );
}

/** 清洗 OCR 文本：与 images 一一对应，长度不足补空串、超出截断，保证下标对齐 */
function sanitizeOcrTexts(raw: unknown, imageCount: number): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || imageCount === 0) return undefined;
  const out: string[] = [];
  for (let i = 0; i < imageCount; i += 1) {
    const item = raw[i];
    out.push(typeof item === 'string' ? item : '');
  }
  return out.every((text) => text === '') ? undefined : out;
}

/** 清洗工具调用轨迹：字段缺失的条目不致命，逐字段回落 */
function sanitizeToolCalls(raw: unknown): ToolCallView[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ToolCallView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    if (!id || !name) continue;
    const args =
      record.arguments && typeof record.arguments === 'object' && !Array.isArray(record.arguments)
        ? (record.arguments as Record<string, unknown>)
        : {};
    const view: ToolCallView = { id, name, arguments: args };
    const result = record.result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      view.result = {
        ok: r.ok === true,
        summary: typeof r.summary === 'string' ? r.summary : '',
        ms: typeof r.ms === 'number' && Number.isFinite(r.ms) ? r.ms : 0,
      };
    }
    out.push(view);
  }
  return out.length > 0 ? out : undefined;
}

/** 气泡是否空到没有保留价值：既无正文也无任何附件/结构化内容 */
function isEmptyBubble(message: HistoryMessage): boolean {
  const hasText = message.content.trim().length > 0;
  const hasImages = (message.images ?? []).some((src) => src !== '');
  const hasOcr = (message.ocrTexts ?? []).some((text) => text !== '');
  const hasFiles = (message.files ?? []).length > 0;
  if (message.role === 'assistant') {
    return (
      !hasText &&
      !message.reasoning?.trim() &&
      !hasImages &&
      !hasOcr &&
      !hasFiles &&
      (message.toolCalls ?? []).length === 0 &&
      (message.awaitingQuestions ?? []).length === 0 &&
      !message.diagnosis
    );
  }
  return !hasText && !hasImages && !hasOcr && !hasFiles;
}

/** 结构化字段的清洗上限（落库数据可能被改坏，只保留 UI 真会渲染的部分） */
const MAX_AWAITING_QUESTIONS = 8;
const MAX_QUESTION_OPTIONS = 6;
const MAX_QUESTION_CHARS = 400;
const MAX_OPTION_CHARS = 120;
const MAX_LABEL_CHARS = 40;
const MAX_KNOWLEDGE_POINTS = 3;
const MAX_KNOWLEDGE_CHARS = 40;
const MAX_HINTS = 3;
const MAX_HINT_CHARS = 300;
const MAX_STRATEGY_STEPS = 6;
const MAX_STRATEGY_STEP_CHARS = 200;
const MAX_NOTE_CHARS = 200;

/** 取自有字段对象（排除 null 与数组） */
function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** 清洗字符串数组：非字符串/空白项丢弃，超量截断 */
function sanitizeStringList(raw: unknown, maxItems: number, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw.slice(0, maxItems)) {
    const text = sanitizeText(item, limit).trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * 清洗 ask_user 待回答问题：question 必填，label / options 逐项校验。
 * 回读路径不再用 as 断言直接信任落库数据——字段被改坏时卡片会渲染出空白项。
 */
function sanitizeAwaitingQuestions(raw: unknown): AskUserQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AskUserQuestion[] = [];
  for (const item of raw.slice(0, MAX_AWAITING_QUESTIONS)) {
    const record = asRecord(item);
    if (!record) continue;
    const question = sanitizeText(record.question, MAX_QUESTION_CHARS).trim();
    if (!question) continue;
    const entry: AskUserQuestion = { question };
    const label = sanitizeText(record.label, MAX_LABEL_CHARS).trim();
    if (label) entry.label = label;
    const options = sanitizeStringList(record.options, MAX_QUESTION_OPTIONS, MAX_OPTION_CHARS);
    if (options.length > 0) entry.options = options;
    out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/** 清洗错因引用：code 必须落在 14 条枚举内，confidence 收敛到 0~1 */
function sanitizeErrorCause(raw: unknown): ErrorCauseRef | null {
  const record = asRecord(raw);
  if (!record) return null;
  const code = typeof record.code === 'string' ? record.code : '';
  if (!isKnownErrorCode(code)) return null;
  const confidence =
    typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? Math.min(1, Math.max(0, record.confidence))
      : 0;
  return { code, confidence };
}

/** 清洗策略卡：errorCode 必须合法，id 与非空 steps 缺一即视为无效（卡片无法渲染） */
function sanitizeStrategyCard(raw: unknown): StrategyCard | null {
  const record = asRecord(raw);
  if (!record) return null;
  const errorCode = typeof record.errorCode === 'string' ? record.errorCode : '';
  if (!isKnownErrorCode(errorCode)) return null;
  const id = sanitizeText(record.id, MAX_LABEL_CHARS).trim();
  const steps = sanitizeStringList(record.steps, MAX_STRATEGY_STEPS, MAX_STRATEGY_STEP_CHARS);
  if (!id || steps.length === 0) return null;
  return {
    errorCode,
    id,
    steps,
    subject: 'math',
    version:
      typeof record.version === 'number' && Number.isFinite(record.version) ? record.version : 1,
  };
}

/** 清洗提示阶梯：level 只接受 1/2/3，content 非空的才保留 */
function sanitizeHints(raw: unknown): HintStep[] {
  if (!Array.isArray(raw)) return [];
  const out: HintStep[] = [];
  for (const item of raw.slice(0, MAX_HINTS)) {
    const record = asRecord(item);
    if (!record) continue;
    const level = record.level;
    if (level !== 1 && level !== 2 && level !== 3) continue;
    const content = sanitizeText(record.content, MAX_HINT_CHARS).trim();
    if (!content) continue;
    out.push({ level, content });
  }
  return out;
}

/** 清洗诊断结论：level 非法整条丢弃，其余字段逐项回落（DiagnosisCard 只渲染已知形状） */
function sanitizeDiagnosis(raw: unknown): DiagnosisResult | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const level = record.level === 'L1' || record.level === 'L2' ? record.level : null;
  if (!level) return undefined;
  const completeness = asRecord(record.completeness) ?? {};
  const diagnosis: DiagnosisResult = {
    subject: 'math',
    level,
    completeness: {
      hasProblem: completeness.hasProblem === true,
      hasStudentAnswer: completeness.hasStudentAnswer === true,
      hasCorrectAnswer: completeness.hasCorrectAnswer === true,
      hasAnalysis: completeness.hasAnalysis === true,
    },
    knowledgePoints: sanitizeStringList(
      record.knowledgePoints,
      MAX_KNOWLEDGE_POINTS,
      MAX_KNOWLEDGE_CHARS
    ),
    errorCause: sanitizeErrorCause(record.errorCause),
    strategy: sanitizeStrategyCard(record.strategy),
    hints: sanitizeHints(record.hints),
    strategyVersion:
      typeof record.strategyVersion === 'number' && Number.isFinite(record.strategyVersion)
        ? record.strategyVersion
        : 1,
  };
  const secondary = sanitizeErrorCause(record.secondaryErrorCause);
  if (secondary) diagnosis.secondaryErrorCause = secondary;
  const notes = sanitizeText(record.notes, MAX_NOTE_CHARS).trim();
  if (notes) diagnosis.notes = notes;
  return diagnosis;
}

/** 清洗单条消息；role 非法返回 null */
function sanitizeMessage(raw: unknown): HistoryMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const role = record.role;
  if (role !== 'user' && role !== 'assistant') return null;

  const id = typeof record.id === 'string' && record.id ? record.id : undefined;
  const message: HistoryMessage = {
    role,
    content: sanitizeText(record.content, MAX_MESSAGE_CHARS),
  };
  if (id) message.id = id;

  const reasoning = sanitizeText(record.reasoning, MAX_MESSAGE_CHARS);
  if (reasoning) message.reasoning = reasoning;

  const images = sanitizeImageSlots(record.images);
  if (images.length > 0) message.images = images;

  const ocrTexts = sanitizeOcrTexts(record.ocrTexts, images.length);
  if (ocrTexts) message.ocrTexts = ocrTexts;

  if (record.imageSendMode === 'local-only' || record.imageSendMode === 'mixed') {
    message.imageSendMode = record.imageSendMode;
  }

  // 复用请求侧同一套文件口径（缺名/无内容/超限逐项丢弃），避免两处漂移
  const files = parseTextFiles(record.files);
  if (files.length > 0) message.files = files;

  const toolCalls = sanitizeToolCalls(record.toolCalls);
  if (toolCalls) message.toolCalls = toolCalls;

  if (Array.isArray(record.awaitingQuestions) && record.awaitingQuestions.length > 0) {
    const awaitingQuestions = sanitizeAwaitingQuestions(record.awaitingQuestions);
    if (awaitingQuestions) message.awaitingQuestions = awaitingQuestions;
  }
  if (record.diagnosis) {
    const diagnosis = sanitizeDiagnosis(record.diagnosis);
    if (diagnosis) message.diagnosis = diagnosis;
  }
  if (record.localOnly === true) message.localOnly = true;
  if (record.blocked === true) message.blocked = true;

  return message;
}

/**
 * 清洗消息数组：非法条目丢弃、同 id 去重（保留首条）、空气泡丢弃。
 * 空气泡是流式中断的典型残留，留着会渲染成一个空白 assistant 条目。
 */
export function sanitizeMessages(raw: unknown): HistoryMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryMessage[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    const message = sanitizeMessage(item);
    if (!message) continue;
    if (message.id) {
      if (seenIds.has(message.id)) continue;
      seenIds.add(message.id);
    }
    if (isEmptyBubble(message)) continue;
    out.push(message);
  }
  return out;
}

/** 清洗过期位置列表：去重、限定为有效下标区间内的整数对 */
export function sanitizeExpiredRefs(raw: unknown, messageCount: number): ExpiredImageRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ExpiredImageRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const msg = record.msg;
    const img = record.img;
    if (!Number.isInteger(msg) || (msg as number) < 0 || (msg as number) >= messageCount) continue;
    if (!Number.isInteger(img) || (img as number) < 0) continue;
    const key = `${msg}:${img}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ msg: msg as number, img: img as number });
  }
  return out;
}

/** 清洗会话体；id 缺失或消息数组非法即视为该条记录损坏（返回 null 交由调用方删除） */
export function sanitizeRecord(raw: unknown): SessionRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id ? record.id : '';
  if (!id) return null;
  const messages = sanitizeMessages(record.messages);
  return {
    id,
    messages,
    expiredImages: sanitizeExpiredRefs(record.expiredImages, messages.length),
  };
}

/** 清洗会话头；时间戳非法回落 0，标题交由 normalizeTitle 兜底 */
export function sanitizeMeta(raw: unknown): SessionMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id ? record.id : '';
  if (!id) return null;

  const numberOrZero = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

  const createdAt = numberOrZero(record.createdAt);
  return {
    id,
    title: normalizeTitle(record.title) ?? UNTITLED_SESSION,
    createdAt,
    updatedAt: numberOrZero(record.updatedAt) || createdAt,
    messageCount: Math.floor(numberOrZero(record.messageCount)),
    textBytes: Math.floor(numberOrZero(record.textBytes)),
    attachmentBytes: Math.floor(numberOrZero(record.attachmentBytes)),
    titleEdited: record.titleEdited === true,
  };
}
