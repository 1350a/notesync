/**
 * 智谱 AI（BigModel）Provider 适配
 *
 * 智谱 v4 端点与 OpenAI Chat Completion 协议完全兼容：
 *   base_url: https://open.bigmodel.cn/api/paas/v4
 *   endpoint: {base_url}/chat/completions
 *   auth:     Authorization: Bearer <API Key>
 * 配置通过环境变量注入（.env.local）：
 *   ZHIPU_API_KEY / ZHIPU_BASE_URL / ZHIPU_MODEL
 */
import { OpenAICompatProvider } from "./openaiCompat";

/** 智谱 API Key（.env.local 中配置，为空则视为不可用） */
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || "";
/** 智谱 OpenAI Chat Completion 兼容端点 */
const ZHIPU_BASE_URL =
  process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
/** 智谱首选模型（可选，经环境变量覆盖/附加） */
const ZHIPU_MODEL = process.env.ZHIPU_MODEL || "";
/** 智谱默认模型列表（glm-5.3 为旗舰，glm-4 为兼容旧版） */
export const ZHIPU_MODELS = ["glm-5.3", "glm-4"];

/** 配置了 key 才认为智谱可用 */
export function zhipuAvailable(): boolean {
  return Boolean(ZHIPU_API_KEY);
}

export class ZhipuProvider extends OpenAICompatProvider {
  constructor() {
    super({
      name: "zhipu",
      apiKey: ZHIPU_API_KEY,
      baseUrl: ZHIPU_BASE_URL,
      defaultModels: ZHIPU_MODELS,
      envModel: ZHIPU_MODEL || undefined,
      displayName: "智谱 AI",
    });
  }
}

/** 单例导出 */
export const zhipuProvider = new ZhipuProvider();

/** 判断模型名是否属于智谱官方/配置模型 */
export function isZhipuModel(model: string): boolean {
  return zhipuProvider.ownsModel(model);
}
