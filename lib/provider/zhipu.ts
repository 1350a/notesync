/**
 * 智谱 AI（BigModel）Provider 适配
 *
 * 智谱 v4 端点与 OpenAI Chat Completion 协议完全兼容：
 *   base_url: https://open.bigmodel.cn/api/paas/v4
 *   endpoint: {base_url}/chat/completions
 *   auth:     Authorization: Bearer <API Key>
 * 配置通过环境变量注入（.env.local）：
 *   ZHIPU_API_KEY / ZHIPU_BASE_URL / ZHIPU_MODEL
 *
 * 注意：智谱官方 OpenAPI 未提供 GET /models 枚举端点，
 * 因此不开启 online 探测（probeEnabled 默认 false），
 * probe 结果为 degraded + 内置白名单，属预期状态而非故障。
 */
import { OpenAICompatProvider } from "./openaiCompat";

/** 智谱 API Key（.env.local 中配置，为空则视为不可用） */
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || "";
/** 智谱 OpenAI Chat Completion 兼容端点 */
const ZHIPU_BASE_URL =
  process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
/** 智谱首选模型（可选，经环境变量覆盖/附加） */
const ZHIPU_MODEL = process.env.ZHIPU_MODEL || "";
/** 智谱模型白名单（glm-5.3 为旗舰，glm-4 为兼容旧版） */
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
      // 官方无 /models 端点：不开探测，直接走白名单降级
      probeEnabled: false,
    });
  }
}

/** 单例导出 */
export const zhipuProvider = new ZhipuProvider();

/** 判断模型名是否属于智谱官方/配置模型 */
export function isZhipuModel(model: string): boolean {
  return zhipuProvider.ownsModel(model);
}
