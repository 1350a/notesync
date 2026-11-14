/**
 * 用户设置 - 模式定义与校验（纯函数，无副作用，可被脚本零依赖直跑冒烟）。
 *
 * 协议见 doc/user-settings.md §2：修改字段前先改文档。
 * 声明但未接线的字段（systemPrompt/generation）仅做类型占位与
 * normalize 钳制，UI 与服务端消费按文档 §6 挂账逐步落地。
 */

/**
 * 主题偏好（doc/user-settings.md §2/§4）：四档互斥。
 * light/dark 为中性灰蓝底，sky/mint 为带色相的浅色主题。
 * 旧版 'system'（跟随系统）已下线：存量数据由 normalizeSettings 一次性映射为
 * 'light'，不再保留 system 分支与 matchMedia 订阅。
 */
export type ThemePreference = 'light' | 'dark' | 'sky' | 'mint';

/**
 * 思考强度档位（doc/user-settings.md §2.1，总账 §5 档位映射的落地）：
 * off 关闭思考（无思维链、省时省费）；low/medium/high 控制推理深度。
 * Provider 映射差异见 mapThinkingParam。
 */
export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high';

export const THINKING_EFFORTS: readonly ThinkingEffort[] = ['off', 'low', 'medium', 'high'];

/**
 * OCR 转写引擎（doc/cloud-ocr.md §4）：决定「谁来转写」。
 * 「要不要转写」不由设置决定——按所选模型能力自动路由（多模态直传、纯文本转写，
 * product-vision.md P4，2026-11-14 拍板）。cloud 档图片像素上行至智谱 glm-ocr，
 * 且为默认档（质量优先；切 local 是隐私动作）。
 */
export type OcrEngine = 'local' | 'cloud';

export const OCR_ENGINES: readonly OcrEngine[] = ['local', 'cloud'];

/**
 * 档位类型守卫：把「外部输入是否属于档位集合」从布尔判断升级为类型收窄，
 * 供服务端校验请求体时替代 `THINKING_EFFORTS.includes(v as never)` 一类的断言逃逸。
 */
export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === 'string' && (THINKING_EFFORTS as readonly string[]).includes(value);
}

/** 生成参数：thinkingEffort 已接线；temperature/maxTokens 仍为占位 */
export interface GenerationSettings {
  /** 思考强度档位；缺省视为 medium（映射时缺省不发参数则视为跟随 provider 默认） */
  thinkingEffort?: ThinkingEffort;
  temperature?: number;
  maxTokens?: number;
}

/** 用户设置统一模式（消费方一律经 normalizeSettings 产出，不手工拼装） */
export interface UserSettings {
  theme: ThemePreference;
  /** 默认模型名；'' = 跟随后端推荐（/api/models 首项） */
  defaultModel: string;
  /** 自定义系统提示词（未接线占位，无 UI） */
  systemPrompt: string;
  /** 生成参数（未接线占位，无 UI） */
  generation: GenerationSettings;
  /**
   * OCR 转写引擎（已接线，doc/cloud-ocr.md §4）：cloud=智谱 glm-ocr（默认，
   * 图片像素出端）；local=tesseract.js 浏览器内。只在纯文本模型路径生效——
   * 多模态模型直传原图、无转写（自动路由，2026-11-14 拍板）
   */
  ocr: { engine: OcrEngine };
  /** 本地知识检索（已接线，doc/browser-local-inference.md §7）：true=发送前浏览器内检索并注入命中片段 */
  rag: { enabled: boolean };
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  defaultModel: '',
  systemPrompt: '',
  generation: {},
  // 引擎默认云端（2026-11-14 拍板，质量优先）：转写只发生在纯文本模型路径，
  // 多模态模型直传原图不经此配置（product-vision.md P4）
  ocr: { engine: 'cloud' },
  rag: { enabled: false },
};

export const SYSTEM_PROMPT_MAX_CHARS = 8000;
export const DEFAULT_MODEL_MAX_CHARS = 200;
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 2;
export const MAX_TOKENS_MIN = 1;
/** 防呆上限：实际仍受上游模型的上下文/输出上限约束 */
export const MAX_TOKENS_MAX = 200_000;

const THEMES: readonly ThemePreference[] = ['light', 'dark', 'sky', 'mint'];

/** 深拷贝默认值，避免消费方误改共享嵌套对象（generation/ocr/rag） */
export function cloneDefaults(): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    generation: { ...DEFAULT_SETTINGS.generation },
    ocr: { ...DEFAULT_SETTINGS.ocr },
    rag: { ...DEFAULT_SETTINGS.rag },
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function normalizeGeneration(raw: unknown): GenerationSettings {
  const out: GenerationSettings = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.thinkingEffort === 'string' &&
    THINKING_EFFORTS.includes(record.thinkingEffort as ThinkingEffort)
  ) {
    out.thinkingEffort = record.thinkingEffort as ThinkingEffort;
  }
  if (typeof record.temperature === 'number' && Number.isFinite(record.temperature)) {
    out.temperature = clamp(record.temperature, TEMPERATURE_MIN, TEMPERATURE_MAX);
  }
  if (
    typeof record.maxTokens === 'number' &&
    Number.isFinite(record.maxTokens) &&
    record.maxTokens >= MAX_TOKENS_MIN
  ) {
    // 有效性先于钳制：maxTokens 没有有意义的零值（与 temperature 不同），≤0 直接丢弃
    out.maxTokens = Math.floor(clamp(record.maxTokens, MAX_TOKENS_MIN, MAX_TOKENS_MAX));
  }
  return out;
}

/**
 * OCR 引擎规整：默认档为云端（2026-11-14 拍板，质量优先，doc/cloud-ocr.md §4）。
 * 非合法枚举值（含旧存储缺字段）一律回落 'cloud'；旧存量的 preferLocal 键按
 * 未知字段丢弃，不做迁移——隐私敏感存量会被迁到云端引擎，这是拍板内容的一部分。
 */
function normalizeOcr(raw: unknown): UserSettings['ocr'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { engine: 'cloud' };
  }
  const record = raw as Record<string, unknown>;
  const engine = (OCR_ENGINES as readonly string[]).includes(record.engine as string)
    ? (record.engine as OcrEngine)
    : 'cloud';
  return { engine };
}

function normalizeRag(raw: unknown): UserSettings['rag'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled: false };
  // 从严布尔：只有显式 true 才生效，其余（含 'true' 字符串）视为未设置
  return { enabled: (raw as Record<string, unknown>).enabled === true };
}

/**
 * 把任意来源（localStorage JSON / 将来的服务端响应）规整为合法设置。
 * 未知字段一律丢弃，保证前向兼容；永不抛错。
 */
export function normalizeSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cloneDefaults();
  const record = raw as Record<string, unknown>;

  // 旧值 'system' 与任何坏值同样不在 THEMES 内，统一回落默认档 light（一次性迁移）
  const theme = THEMES.includes(record.theme as ThemePreference)
    ? (record.theme as ThemePreference)
    : DEFAULT_SETTINGS.theme;
  const defaultModel =
    typeof record.defaultModel === 'string'
      ? record.defaultModel.slice(0, DEFAULT_MODEL_MAX_CHARS)
      : DEFAULT_SETTINGS.defaultModel;
  // 语言占位已删（2026-11-14 砍掉多语言方向）；旧存量 language 键由"未知字段丢弃"自然清除
  const systemPrompt =
    typeof record.systemPrompt === 'string'
      ? record.systemPrompt.slice(0, SYSTEM_PROMPT_MAX_CHARS)
      : '';

  return {
    theme,
    defaultModel,
    systemPrompt,
    generation: normalizeGeneration(record.generation),
    ocr: normalizeOcr(record.ocr),
    rag: normalizeRag(record.rag),
  };
}
