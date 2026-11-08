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
 * 模型清单策略（2026-11 实测校准）：
 * - 官方提供 GET /models 枚举端点，但清单不完整——免费款 glm-4.7-flash
 *   不在枚举结果中（实际可调用，HTTP 429 忙线而非 1211 模型不存在），
 *   因此枚举只用于健康判定（probeHealthOnly），模型名以聚焦目录为准；
 * - 目录带元数据（vision=多模态，free=免费款），向下流动成下拉标注与
 *   图片直传/降级行为；后续接入新模型在 ZHIPU_CATALOG 加一行即可。
 */
import { OpenAICompatProvider } from "./openaiCompat";

/** 智谱 API Key（.env.local 中配置，为空则视为不可用） */
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || "";
/** 智谱 OpenAI Chat Completion 兼容端点 */
const ZHIPU_BASE_URL =
  process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
/** 智谱首选模型（可选，参与路由归属；是否出现在下拉由目录决定） */
const ZHIPU_MODEL = process.env.ZHIPU_MODEL || "";

/** 智谱聚焦模型目录条目 */
export interface ZhipuModelMeta {
  /** API 模型名 */
  name: string;
  /** 是否多模态（支持图片/视频/文件输入；当前发送链路仅实际使用 image_url） */
  vision: boolean;
  /** 是否免费款（开发测试零成本） */
  free?: boolean;
}

/** 智谱聚焦模型目录（顺序即下拉展示顺序） */
export const ZHIPU_CATALOG: ZhipuModelMeta[] = [
  { name: "glm-5.3", vision: false },
  { name: "glm-5.3-flash", vision: true },
  { name: "glm-5.3-flashx", vision: true },
  { name: "glm-4.7-flash", vision: false, free: true },
];

const ZHIPU_MODEL_NAMES = ZHIPU_CATALOG.map((m) => m.name);
const ZHIPU_VISION_MODELS = new Set(
  ZHIPU_CATALOG.filter((m) => m.vision).map((m) => m.name)
);

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
      defaultModels: ZHIPU_MODEL_NAMES,
      envModel: ZHIPU_MODEL || undefined,
      displayName: "智谱 AI",
      // 枚举端点存在但清单不完整：开启探测用于健康判定（401 可见、状态可升 ok），
      // 同时走 healthOnly 让模型名始终来自聚焦目录
      probeEnabled: true,
      probeHealthOnly: true,
    });
  }

  /** 目录标注的多模态能力；目录外模型（含 envModel）按纯文本处理，宁可降级也不要上游 400 */
  modelAcceptsImages(model: string): boolean {
    return ZHIPU_VISION_MODELS.has(model.trim().toLowerCase());
  }

  isFreeModel(model: string): boolean {
    const target = model.trim().toLowerCase();
    const hit = ZHIPU_CATALOG.find((m) => m.name.toLowerCase() === target);
    return Boolean(hit?.free);
  }
}

/** 单例导出 */
export const zhipuProvider = new ZhipuProvider();

/** 判断模型名是否属于智谱官方/配置模型 */
export function isZhipuModel(model: string): boolean {
  return zhipuProvider.ownsModel(model);
}
