/**
 * 上游错误原文脱敏（对应审查项 S2）。
 *
 * 上游 4xx/5xx 的响应体常带 request_id、trace id、账号邮箱、密钥片段与内部字段名。
 * 此前这些内容被原样拼进 error 事件下发到浏览器——实测真实 402 响应里就带
 * `request_id`（见 doc/chat-history.md 的排错记录）。
 *
 * 这里保留可诊断的部分（错误语义、状态码、关键短语），抹掉能定位到具体账号或
 * 具体请求的标识，并截断长度；完整原文仍然进服务端日志（console.error），
 * 排错能力不受影响。
 */

/** 摘要字符上限：够放下「Insufficient Balance」这类短语义，又不至于把响应体整段带出 */
export const MAX_ERROR_SUMMARY_CHARS = 200;

/**
 * 抹掉可定位标识 + 压平空白 + 截断。
 *
 * 顺序有讲究：先按模式替换，最后再 slice——先截断会把 UUID / 邮箱切断，
 * 导致后续正则认不出来。
 */
export function redactUpstreamText(text: string): string {
  if (!text) return '';
  return text
    // UUID：request_id / trace id 最常见形态
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    // 键值对形态的追踪标识（request_id: xxx / traceId=xxx）
    .replace(
      /\b(request_?id|trace_?id|req_?id|rid|session_?id)\b\s*[:=]\s*["']?[\w.-]{6,}["']?/gi,
      '$1=[id]',
    )
    // 邮箱：直接指向账号
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    // 密钥形态（sk-xxxx / ak-xxxx）
    .replace(/\b(?:sk|ak|pk)-[A-Za-z0-9_-]{8,}/g, '[key]')
    // 长 hex / 疑似签名或令牌
    .replace(/\b[0-9a-f]{32,}\b/gi, '[token]')
    // 压平换行与多余空白，避免摘要里混进大段 JSON
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_SUMMARY_CHARS);
}

/**
 * 从上游响应体里只取「语义」那一句，再交给 {@link redactUpstreamText} 脱敏。
 *
 * 直接把整段 JSON 塞进摘要会把 `type` / `param` / `code` 等上游内部字段一并
 * 暴露到浏览器，其中的 `code` 还容易和本地 `error.code` 混淆。这里按常见形态
 * 取 message 文本（`error.message` / `error` 字符串 / 顶层 `message` / `msg`），
 * 解析不了（网关返回 HTML 或纯文本）就退回原文，语义不丢。
 */
export function extractUpstreamMessage(raw: string): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  try {
    const parsed: unknown = JSON.parse(text);
    const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    if (record) {
      const error = record.error;
      if (typeof error === 'string' && error.trim()) return error.trim();
      if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string' && message.trim()) return message.trim();
      }
      if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
      if (typeof record.msg === 'string' && record.msg.trim()) return record.msg.trim();
    }
  } catch {
    // 非 JSON：原文继续走脱敏流程
  }
  return text;
}

/** 日志侧最多留存的原文长度：够定位问题，又不至于把整段响应体写进日志 */
export const MAX_ERROR_LOG_CHARS = 2000;

/* ============================ trace 导出脱敏（批次 3-C） ============================ */

/**
 * trace 导出脱敏：只作用于**导出的副本**，浏览器内存储保持原文。
 *
 * 为什么需要：trace 里的 `reasoning` 是模型自述，实测会逐字复述系统提示词与内部
 * 字段名（`completeness` / `hintLevel` / `submit_diagnosis` / `DISCIPLINE_BLOCK`
 * 的条款原文等）。这份文件是要送审/演示时导出的，条款外露等于把防绕过说明书一起
 * 交出去；但本地分析仍需要完整推理，所以**写入不截断，只在导出出口脱敏**。
 *
 * 白名单优先：公式、代码、URL 先被抽走换成占位符，脱敏规则跑完再原样放回——
 * 数学题面（`x²`、`f(x)=…`、`△ABC`、LaTeX）绝不因为含英文字母或下划线被改写。
 */

/** 白名单占位符：用不可见控制符包住序号，避免与正文中任何真实字符冲突 */
const SEGMENT_OPEN = '\u0001';
const SEGMENT_CLOSE = '\u0002';

/**
 * 需要原样保护的白名单片段类型。顺序即抽取顺序：长片段优先（代码块先于行内代码，
 * `$$…$$` 先于 `$…$`），否则内层会被外层提前吃掉导致还原错位。
 */
const PROTECTED_SEGMENT_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/g, // 围栏代码块
  /~~~[\s\S]*?~~~/g,
  /`[^`\n]*`/g, // 行内代码
  /\$\$[\s\S]*?\$\$/g, // 块级公式
  /\$[^$\n]+\$/g, // 行内公式
  /\\\[[\s\S]*?\\\]/g, // \[ … \]
  /\\\([\s\S]*?\\\)/g, // \( … \)
  /https?:\/\/[^\s"'<>）)]+/g, // 链接：脱敏不该改地址
];

/** 内部字段名与工具名：命中即替换，避免把实现细节写进送审材料 */
const INTERNAL_FIELD_TOKENS = [
  'completeness',
  'hintLevel',
  'submit_diagnosis',
  'lookup_strategy',
  'ask_user',
  'diagnoseState',
  'errorCause',
  'strategyCard',
  'masteryLevel',
  'awaitingQuestions',
  'systemPrompt',
  'thinkingEffort',
  'maxTokens',
  'ragMinQueryChars',
  'maxAttachments',
  'completenessResult',
  'refused',
];

/** 提示条款/协议常量名：出现在推理里等于把内部规则标题交出去 */
const INTERNAL_CONST_TOKENS = [
  'DISCIPLINE_BLOCK',
  'SCOPE_BOUNDARY_LINE',
  'CHAT_BASE_SYSTEM_PROMPT',
  'REFUSAL_PREFIX',
  'INJECTION_PATTERNS',
  'BLOCKED_USER_PLACEHOLDER',
  'BLOCK_COOLDOWN_MS',
  'PSYCH_SUPPORT_MESSAGE',
  'CONTENT_BLOCKED_MESSAGE',
  'HARD_BLOCK_MESSAGE',
  'RAG_MIN_QUERY_CHARS',
  'TRACE_MAX_CHARS',
];

/** 提示条款的自然语言特征串（中英）：命中整句/整段特征即抹成占位 */
const PROMPT_CLAUSE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // 系统提示里的角色/边界声明
  { pattern: /你是[^\n。！？]{0,30}(助手|老师|错题|诊断)[^\n。！？]{0,20}[。！]?/g, replacement: '[提示条款已脱敏]' },
  { pattern: /材料非指令/g, replacement: '[提示条款已脱敏]' },
  { pattern: /铁律[：:][^\n]{0,80}/g, replacement: '[提示条款已脱敏]' },
  { pattern: /(解析从题目出发|诊断从学生的作答出发)[^\n。]{0,40}/g, replacement: '[提示条款已脱敏]' },
  {
    pattern: /(不得|禁止|严禁)(泄露|输出|复述|回显|打印)[^\n。]{0,50}/g,
    replacement: '[提示条款已脱敏]',
  },
  { pattern: /【边界说明】/g, replacement: '[提示条款已脱敏]' },
  // 英文条款标题（Task 1 / Task 2 / §x 之类分节标记）
  { pattern: /\bTask\s*[12]\b[^\n]{0,60}/gi, replacement: '[提示条款已脱敏]' },
  { pattern: /\b(?:system\s*prompt|system\s*instruction)\b[^\n]{0,40}/gi, replacement: '[提示条款已脱敏]' },
  { pattern: /\bprotocol\b/gi, replacement: '[内部字段]' },
];

/** 依次替换的规则表：字段名/常量名跑在条款特征之前，条款特征可能把它们一起吃掉 */
const TOKEN_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  ...[...INTERNAL_CONST_TOKENS, ...INTERNAL_FIELD_TOKENS].map((token) => ({
    // 边界用「非标识符字符」而非 \b：`submit_diagnosis` 后接中文时 \b 不成立
    pattern: new RegExp(`(?<![A-Za-z0-9_])${token}(?![A-Za-z0-9_])`, 'g'),
    replacement: '[内部字段]',
  })),
  ...PROMPT_CLAUSE_PATTERNS,
];

/**
 * 抽走白名单片段 → 跑脱敏 → 放回片段。
 *
 * 占位符用 `\u0001序号\u0002`：控制符不会出现在正常文本里，且还原时按序号精确回填，
 * 不会因为多次替换导致错位。
 */
function withProtectedSegments(text: string, transform: (body: string) => string): string {
  const segments: string[] = [];
  let masked = text;
  for (const pattern of PROTECTED_SEGMENT_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      segments.push(match);
      return `${SEGMENT_OPEN}${segments.length - 1}${SEGMENT_CLOSE}`;
    });
  }
  const processed = transform(masked);
  return processed.replace(
    new RegExp(`${SEGMENT_OPEN}(\\d+)${SEGMENT_CLOSE}`, 'g'),
    (whole, index: string) => segments[Number(index)] ?? whole,
  );
}

/**
 * trace 导出前的文本脱敏（幂等，可安全重复调用）。
 *
 * 只做「抹掉内部痕迹」，不做长度截断——保住长推导的可分析性。
 * 正常数学文本（公式/代码/链接）走白名单，原样保留。
 */
export function redactTraceText(text: string): string {
  if (!text) return '';
  return withProtectedSegments(text, (body) =>
    TOKEN_PATTERNS.reduce((acc, { pattern, replacement }) => acc.replace(pattern, replacement), body),
  );
}

