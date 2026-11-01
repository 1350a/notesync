/**
 * 自定义模型 Provider 适配
 *
 * 仅要求遵循 OpenAI API 规范，用户通过环境变量配置：
 *   CUSTOM_API_KEY / CUSTOM_BASE_URL / CUSTOM_MODEL
 * 未配置 CUSTOM_BASE_URL / CUSTOM_MODEL 时视为不可用（无法凭空推断端点）。
 */
import { OpenAICompatProvider } from "./openaiCompat";

/** 自定义 API Key（.env.local 中配置，为空则视为不可用） */
const CUSTOM_API_KEY = process.env.CUSTOM_API_KEY || "";
/** 自定义 OpenAI 兼容 Base URL（必须显式配置，无默认值） */
const CUSTOM_BASE_URL = process.env.CUSTOM_BASE_URL || "";
/** 自定义模型名（必须显式配置，无默认值） */
const CUSTOM_MODEL = process.env.CUSTOM_MODEL || "";

/** key / base url / 模型名齐备才认为自定义模型可用 */
export function customAvailable(): boolean {
  return Boolean(CUSTOM_API_KEY && CUSTOM_BASE_URL && CUSTOM_MODEL);
}

export class CustomProvider extends OpenAICompatProvider {
  constructor() {
    super({
      name: "custom",
      apiKey: CUSTOM_API_KEY,
      baseUrl: CUSTOM_BASE_URL,
      defaultModels: CUSTOM_MODEL ? [CUSTOM_MODEL] : [],
      envModel: CUSTOM_MODEL || undefined,
      displayName: "自定义模型",
    });
  }
}

/** 单例导出 */
export const customProvider = new CustomProvider();

/** 判断模型名是否属于自定义配置模型 */
export function isCustomModel(model: string): boolean {
  return customProvider.ownsModel(model);
}
