/**
 * DeepSeek API Provider 适配
 *
 * OpenAI 兼容端点 /chat/completions，Bearer 鉴权；支持 GET /models 在线枚举。
 * 配置通过环境变量注入（.env.local）：
 *   DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
 */
import { OpenAICompatProvider, PROBE_TIMEOUT_CLOUD } from "./openaiCompat";

/** DeepSeek API Key（.env.local 中配置，为空则视为不可用） */
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
/** DeepSeek OpenAI 兼容端点 */
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
/** DeepSeek 首选模型（可选，经环境变量覆盖/附加） */
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "";

/**
 * DeepSeek 现行模型名（官方价目表口径）。
 * 用作枚举失败时的白名单兜底，正常情况以 GET /models 返回为准。
 */
export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"];

/**
 * 旧模型名：deepseek-chat / deepseek-reasoner 已于 2026-07-24 弃用；
 * deepseek-v4-flash / deepseek-v4-flash-vision-exp 为过渡别名，仍可调用但已非主推。
 * 仅保留导出以兼容历史引用，不进入白名单。
 */
export const DEEPSEEK_LEGACY_MODELS = ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];

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
    });
  }

  /**
   * 按模型名判定图片能力：仅含 vision 的过渡别名可直传，官方文本款一律纯文本。
   * 文本款直传 image_url 会被上游 400，保守交由输入区的本地 OCR 转文字通道。
   */
  modelAcceptsImages(model: string): boolean {
    return /vision/i.test(model);
  }
}

/** 单例导出 */
export const deepseekProvider = new DeepSeekProvider();

/** 判断模型名是否属于 DeepSeek 官方/配置模型 */
export function isDeepSeekModel(model: string): boolean {
  return deepseekProvider.ownsModel(model);
}
