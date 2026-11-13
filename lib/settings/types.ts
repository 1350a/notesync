/**
 * 用户设置 - 模式定义与校验（纯函数，无副作用，可被脚本零依赖直跑冒烟）。
 *
 * 协议见 doc/user-settings.md §2：修改字段前先改文档。
 * 声明但未接线的字段（language/systemPrompt/generation）仅做类型占位与
 * normalize 钳制，UI 与服务端消费按文档 §6 挂账逐步落地。
 */

/** 主题偏好：system 跟随系统（matchMedia 实时联动） */
export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * 思考强度档位（doc/user-settings.md §2.1，总账 §5 档位映射的落地）：
 * off 关闭思考（无思维链、省时省费）；low/medium/high 控制推理深度。
 * Provider 映射差异见 mapThinkingParam。
 */
export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high';

export const THINKING_EFFORTS: readonly ThinkingEffort[] = ['off', 'low', 'medium', 'high'];

/**
 * OCR 转写引擎（doc/cloud-ocr.md §4）：与档位偏好 preferLocal 正交——
 * preferLocal 决定「要不要转写」，engine 决定「谁来转写」。
 * cloud 档图片像素上行至智谱 glm-ocr，默认保守档为 local（P4 约束③）。
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
  /** 界面语言（未接线占位，当前仅中文） */
  language: 'system';
  /** 自定义系统提示词（未接线占位，无 UI） */
  systemPrompt: string;
  /** 生成参数（未接线占位，无 UI） */
  generation: GenerationSettings;
  /**
   * OCR 偏好（已接线，doc/browser-local-ocr.md §6.1 + doc/cloud-ocr.md §4）：
   * preferLocal 默认档为「全本地」（P4 约束③）——true=图片一律先转文字；
   * engine 为转写引擎，cloud=智谱 glm-ocr（图片像素出端，显式开启）
   */
  ocr: { preferLocal: boolean; engine: OcrEngine };
  /** 本地知识检索（已接线，doc/browser-local-inference.md §7）：true=发送前浏览器内检索并注入命中片段 */
  rag: { enabled: boolean };
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  defaultModel: '',
  language: 'system',
  systemPrompt: '',
  generation: {},
  // 保守档默认：图片先本地转文字，原图不出端（product-vision.md P4 约束③）
  ocr: { preferLocal: true, engine: 'local' },
  rag: { enabled: false },
};

export const SYSTEM_PROMPT_MAX_CHARS = 8000;
export const DEFAULT_MODEL_MAX_CHARS = 200;
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 2;
export const MAX_TOKENS_MIN = 1;
/** 防呆上限：实际仍受上游模型的上下文/输出上限约束 */
export const MAX_TOKENS_MAX = 200_000;

const THEMES: readonly ThemePreference[] = ['light', 'dark', 'system'];

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
 * OCR 偏好规整：默认档是「全本地 + 本地引擎」（图片先转文字，原图不出端）。
 * 与 normalizeRag 的「只有显式 true 才生效」相反——这里的保守侧是 true，
 * 因此只有 **显式 false** 才关闭；缺省、'false' 字符串、坏值一律回落到默认档。
 * （宁可多一次本地识别，也不误把图片外发。）
 * engine 同理保守：非合法枚举值（含旧存储缺字段）一律回落 'local'——
 * 云端引擎意味着图片像素出端，必须由显式合法值开启（doc/cloud-ocr.md §4）。
 */
function normalizeOcr(raw: unknown): UserSettings['ocr'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { preferLocal: true, engine: 'local' };
  }
  const record = raw as Record<string, unknown>;
  const engine = (OCR_ENGINES as readonly string[]).includes(record.engine as string)
    ? (record.engine as OcrEngine)
    : 'local';
  return { preferLocal: record.preferLocal !== false, engine };
}

function normalizeRag(raw: unknown): UserSettings['rag'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled: false };
  // 从严布尔：只有显式 true 才生效，其余（含 'true' 字符串）视为未设置；与 ocr.preferLocal 的保守侧相反
  return { enabled: (raw as Record<string, unknown>).enabled === true };
}

/**
 * 把任意来源（localStorage JSON / 将来的服务端响应）规整为合法设置。
 * 未知字段一律丢弃，保证前向兼容；永不抛错。
 */
export function normalizeSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cloneDefaults();
  const record = raw as Record<string, unknown>;

  const theme = THEMES.includes(record.theme as ThemePreference)
    ? (record.theme as ThemePreference)
    : DEFAULT_SETTINGS.theme;
  const defaultModel =
    typeof record.defaultModel === 'string'
      ? record.defaultModel.slice(0, DEFAULT_MODEL_MAX_CHARS)
      : DEFAULT_SETTINGS.defaultModel;
  // 语言当前只有唯一取值；引入 i18n 时在此按语言包清单收窄
  const language: UserSettings['language'] = 'system';
  const systemPrompt =
    typeof record.systemPrompt === 'string'
      ? record.systemPrompt.slice(0, SYSTEM_PROMPT_MAX_CHARS)
      : '';

  return {
    theme,
    defaultModel,
    language,
    systemPrompt,
    generation: normalizeGeneration(record.generation),
    ocr: normalizeOcr(record.ocr),
    rag: normalizeRag(record.rag),
  };
}
