/**
 * Provider 路由与模型列表聚合
 *
 * - resolveProvider：根据请求模型名与 DeepSeek key 决定实际 provider
 * - normalizeModel：请求 deepseek 模型但无 key 时回退 ollama 默认模型
 * - getModelList：聚合 DeepSeek 与 ollama 模型，供 /api/models 使用
 */
import { deepseekProvider, DEEPSEEK_MODELS, deepseekAvailable } from "./deepseek";
import { ollamaProvider } from "./ollama";
import type { LLMProvider, ProviderModel } from "./types";

/** ollama 默认回退模型（无 DeepSeek key 时使用） */
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b";

/** 判断某个模型名是否属于 DeepSeek 官方模型 */
export function isDeepSeekModel(model: string): boolean {
  return DEEPSEEK_MODELS.includes(model);
}

/**
 * 解析请求模型应走的 provider 与最终模型名。
 * - DeepSeek key 存在且模型为 deepseek 官方模型 → DeepSeek
 * - 请求 deepseek 模型但无 key → 回退 ollama 默认模型（保留现有回退行为）
 * - 其余情况（qwen2.5:7b、ollama 自定义模型）→ ollama
 */
export function resolveProvider(model: string): {
  provider: LLMProvider;
  model: string;
} {
  if (deepseekAvailable() && isDeepSeekModel(model)) {
    return { provider: deepseekProvider, model };
  }
  if (isDeepSeekModel(model)) {
    return { provider: ollamaProvider, model: DEFAULT_OLLAMA_MODEL };
  }
  return { provider: ollamaProvider, model: model || DEFAULT_OLLAMA_MODEL };
}

/**
 * 拉取前端模型下拉列表。
 * - 有 DeepSeek key：DeepSeek 模型在前，ollama 可用时追加本地模型
 * - 无 key：仅 ollama 模型（失败返回 available=false 与提示）
 */
export async function getModelList(): Promise<{
  models: ProviderModel[];
  available: boolean;
  message?: string;
}> {
  const useDeepSeek = deepseekAvailable();

  if (useDeepSeek) {
    const deepseekModels = await deepseekProvider.listModels();
    const ollamaModels = await ollamaProvider.listModels();
    return {
      models: [...deepseekModels, ...ollamaModels],
      available: true,
      message: ollamaModels.length === 0 ? "DeepSeek 可用；本地 ollama 未连接。" : undefined,
    };
  }

  const models = await ollamaProvider.listModels();
  if (models.length === 0) {
    return {
      models: [],
      available: false,
      message: "无法连接本地 ollama 服务，请确认已安装并运行 ollama（默认端口 11434）。",
    };
  }
  return { models, available: true };
}
