/**
 * 环境变量取值诊断（doc/help-about-.env.md §9.1）
 *
 * 本模块**不改写任何判定口径**：布尔开关仍是严格字符串比较，数值变量仍按 parseInt 回落默认。
 * 它只负责"留痕"——把原本完全静默的填错变成一条带 `[env]` 前缀的 warn。
 * 填错照样不抛错、不中断请求：配置写错是运维问题，不该让一次对话 500。
 *
 * 与 `lib/diagnose/parse-attachments.ts` 同口径：降级但看得见（能力降级不静默）。
 */

/** 已告警过的变量：同一进程内同一变量只 warn 一次，避免每个请求刷屏 */
const warned = new Set<string>();

/** 测试用：清空告警去重记录 */
export function resetEnvWarnings(): void {
  warned.clear();
}

/** 记录一条环境变量告警（同一 key 只报一次） */
export function warnEnvOnce(key: string, detail: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[env] ${key}：${detail}`);
}

/**
 * 非负整数型变量的解析（`TRIM_BUDGET_CHARS` / `TOOL_MAX_ROUNDS` 共用）。
 *
 * - 缺失或空串：正常状态（没配就是用默认），静默返回默认值
 * - 可解析且非负：原样采用，`0` 是合法值（0 预算 = 禁用裁剪 / 不执行工具）
 * - 填了但解析失败或为负：回落默认值并 warn 一次
 *
 * 保留 `parseInt` 语义（`"12k"` → `12`）以维持既有行为，只补留痕。
 */
export function resolveNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  warnEnvOnce(name, `值 "${raw}" 不是非负整数，已回落默认 ${fallback}`);
  return fallback;
}

/**
 * 布尔 / 枚举开关的校验口径。
 *
 * 判定逻辑在各自模块里（严格字符串比较），这里只登记「认可的写法」与「填错后实际落到的方向」，
 * 用于启动期把危险的静默方向指出来，而不是改掉它。
 */
interface SwitchSpec {
  name: string;
  /** 代码明确认可的写法（大小写敏感，与各处 `===` 比较保持一致） */
  accepted: readonly string[];
  /** 填错值时实际落到的方向 */
  actual: string;
  /** 落到该方向的后果 */
  impact: string;
}

const SWITCH_SPECS: readonly SwitchSpec[] = [
  {
    name: 'TOOLS_ENABLED',
    accepted: ['true', 'false'],
    actual: '开启（工具照常执行）',
    impact: '想关掉工具调用时写错会静默无效',
  },
  {
    name: 'USER_FIELD_ENABLED',
    accepted: ['0', '1'],
    actual: '开启（随请求透传 user 字段）',
    impact: '写错关不掉，仅多透传一个字段',
  },
  {
    name: 'CUSTOM_ALLOW_IMAGES',
    accepted: ['0', '1'],
    actual: '关闭（图片改走本地 OCR 转文字）',
    impact: '真多模态端点会白白丢掉原图',
  },
  {
    name: 'MOCK_MODEL',
    accepted: ['0', '1'],
    actual: '关闭（真实调用上游模型）',
    impact: '以为在 mock 联调，实际会消耗额度',
  },
  {
    name: 'MOCK_OCR',
    accepted: ['0', '1'],
    actual: '关闭（真实调用云端 OCR）',
    impact: '以为在 mock 联调，实际会消耗额度',
  },
  {
    name: 'MOCK_PARSE_DOC',
    accepted: ['0', '1'],
    actual: '关闭（真实走文档解析链路）',
    impact: '以为在 mock 联调，实际走真实链路',
  },
  {
    name: 'MOCK_IMAGE_MODE',
    accepted: ['', 'text-only'],
    actual: '自动（按模型能力决定）',
    impact: '想锁定纯文本链路时写错会退回自动',
  },
  {
    name: 'CUSTOM_TOOL_MODE',
    accepted: ['native', 'text'],
    actual: 'native（原生 tools 字段）',
    impact: '不支持 tools 的端点会拿不到工具调用',
  },
];

/** 三家 Provider 的 Base URL：填错会让所有请求直接失败，属 B 类必须拦在前面的坑 */
const BASE_URL_VARS: readonly string[] = ['DEEPSEEK_BASE_URL', 'ZHIPU_BASE_URL', 'CUSTOM_BASE_URL'];

/** 合法的 http(s) 地址：不带引号、不带空白（`.env` 里加引号是常见坑） */
const HTTP_URL = /^https?:\/\/[^\s"']+$/;

/**
 * 启动期校验（`instrumentation.ts` 的 `register()` 调用）：
 * 扫一遍布尔开关与 Base URL，把"填了但不会按预期生效"的项各 warn 一条。
 * 未配置的变量一律跳过——"没配"是正常状态，不是故障。
 */
export function validateEnv(): void {
  for (const spec of SWITCH_SPECS) {
    const raw = process.env[spec.name];
    if (raw === undefined) continue;
    if (spec.accepted.includes(raw)) continue;
    warnEnvOnce(
      spec.name,
      `值 "${raw}" 不是认可的写法（${spec.accepted.filter(Boolean).join(' / ')}），`
        + `当前实际为「${spec.actual}」——${spec.impact}`,
    );
  }

  for (const name of BASE_URL_VARS) {
    const raw = process.env[name];
    if (!raw) continue;
    if (HTTP_URL.test(raw)) continue;
    warnEnvOnce(name, `值 "${raw}" 不是合法的 http(s) 地址（不要加引号或空格），该 Provider 的请求会直接失败`);
  }
}
