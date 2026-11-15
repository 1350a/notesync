/**
 * DeepSeek API Provider 适配
 *
 * OpenAI 兼容端点 /chat/completions，Bearer 鉴权；支持 GET /models 在线枚举。
 * 配置通过环境变量注入（.env.local）：
 *   DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL / DEEPSEEK_SAFETY_CHECK
 */
import { OpenAICompatProvider, PROBE_TIMEOUT_CLOUD } from "./openaiCompat";

/** DeepSeek API Key（.env.local 中配置，为空则视为不可用） */
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
/** DeepSeek OpenAI 兼容端点 */
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
/** DeepSeek 首选模型（可选，经环境变量覆盖/附加） */
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "";

/**
 * 服务端内容安全审核档位（safety-protocol.md §3.2，DEEPSEEK_SAFETY_CHECK）。
 * `high` 开启；`low` / `off` / 未配置 = 不发送（行为与不传一致）。
 * 与 USER_FIELD_ENABLED 等开关同口径：严格字符串比较，不归一大小写——
 * 填错的留痕在 lib/config/env.ts validateEnv，这里只按认可值收敛。
 */
export function resolveSafetyCheck(
  raw: string | undefined,
): 'low' | 'high' | undefined {
  return raw === 'low' || raw === 'high' ? raw : undefined;
}

/**
 * DeepSeek 现行模型名（官方价目表口径）。
 * 用作枚举失败时的白名单兜底，正常情况以 GET /models 返回为准。
 */
export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"];

/** 配置了 key 才认为 DeepSeek 可用 */
export function deepseekAvailable(): boolean {
  return Boolean(DEEPSEEK_API_KEY);
}

export class DeepSeekProvider extends OpenAICompatProvider {
  constructor() {
    super({
      name: "deepseek",
      apiKey: DEEPSEEK_API_KEY,
      baseUrl: DEEPSEEK_BASE_URL,
      defaultModels: DEEPSEEK_MODELS,
      envModel: DEEPSEEK_MODEL || undefined,
      displayName: "DeepSeek",
      probeEnabled: true,
      probeTimeoutMs: PROBE_TIMEOUT_CLOUD,
      // 服务端内容安全审核（safety-protocol.md §3.2）：默认不发送，DEEPSEEK_SAFETY_CHECK=high 开启
      safetyCheck: resolveSafetyCheck(process.env.DEEPSEEK_SAFETY_CHECK),
    });
  }

  /**
   * 按模型名判定图片能力：官方 Vision 款（flash 系列，含 vision 过渡别名）可直传，
   * v4-pro 等纯文本款一律按文本处理。
   * 文本款直传 image_url 会被上游 400，保守交由输入区的本地 OCR 转文字通道。
   */
  modelAcceptsImages(model: string): boolean {
    return /flash|vision/i.test(model.trim());
  }
}

/** 单例导出 */
export const deepseekProvider = new DeepSeekProvider();

/** 判断模型名是否属于 DeepSeek 官方/配置模型 */
export function isDeepSeekModel(model: string): boolean {
  return deepseekProvider.ownsModel(model);
}
