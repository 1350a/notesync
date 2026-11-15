/**
 * 自定义模型 Provider 适配
 *
 * 仅要求遵循 OpenAI API 规范，用户通过环境变量配置：
 *   CUSTOM_API_KEY / CUSTOM_BASE_URL / CUSTOM_MODEL
 * - CUSTOM_BASE_URL 必须显式配置（无默认值，无法凭空推断端点）
 * - CUSTOM_MODEL 为可选首选模型：支持 GET /models 的端点（如本机 Ollama、vLLM）
 *   可直接从枚举结果取模型名；配置值仅用于置顶与校验
 */
import { OpenAICompatProvider, PROBE_TIMEOUT_CUSTOM } from "./openaiCompat";

/** 自定义 API Key（.env.local 中配置，为空则视为不可用） */
const CUSTOM_API_KEY = process.env.CUSTOM_API_KEY || "";
/** 自定义 OpenAI 兼容 Base URL（必须显式配置，无默认值） */
const CUSTOM_BASE_URL = process.env.CUSTOM_BASE_URL || "";
/** 自定义首选模型名（可选，配置后置顶并参与名称校验） */
const CUSTOM_MODEL = process.env.CUSTOM_MODEL || "";
/**
 * 自定义端点是否接受图片直传（显式开启才生效）。
 * 默认纯文本：自定义端点多为本地 Ollama / vLLM 纯文本模型，默认直传 image_url
 * 必然 400；真多模态端点由用户显式声明（doc/browser-local-ocr.md §6.3）。
 */
const CUSTOM_ALLOW_IMAGES = process.env.CUSTOM_ALLOW_IMAGES === "1";

/** key + base url 齐备才认为自定义模型可用（模型名可由 /models 枚举获得） */
export function customAvailable(): boolean {
  return Boolean(CUSTOM_API_KEY && CUSTOM_BASE_URL);
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
      // 图片能力默认关闭：配合输入区的本地 OCR 转文字通道，纯文本端点也能消费图片内容
      allowImages: CUSTOM_ALLOW_IMAGES,
      // 自定义端点多为本地 Ollama / vLLM，放宽超时
      probeEnabled: true,
      probeTimeoutMs: PROBE_TIMEOUT_CUSTOM,
    });
  }
}

/** 单例导出 */
export const customProvider = new CustomProvider();

/** 判断模型名是否属于自定义配置模型 */
export function isCustomModel(model: string): boolean {
  return customProvider.ownsModel(model);
}
