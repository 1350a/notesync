/**
 * Provider 路由与模型列表聚合
 *
 * - resolveProvider：根据请求模型名与各云端 key 决定实际 provider
 *   （模型归属按模型名区分：deepseek / zhipu / custom / ollama）
 * - getModelList：聚合所有可用 provider 的模型，供 /api/models 使用
 */
import {
  deepseekProvider,
  deepseekAvailable,
  isDeepSeekModel,
} from "./deepseek";
import { zhipuProvider, zhipuAvailable, isZhipuModel } from "./zhipu";
import { customProvider, customAvailable, isCustomModel } from "./custom";
import { ollamaProvider } from "./ollama";
import type { LLMProvider, ProviderModel } from "./types";

/** ollama 默认回退模型（云端模型无 key 时使用） */
export const DEFAULT_OLLAMA_MODEL = "deepseek-local";

/** 解析云端模型名对应的 provider；模型名属于云端但对应 key 缺失时返回 null */
function resolveCloud(model: string): { provider: LLMProvider; model: string } | null {
  if (isDeepSeekModel(model)) {
    return deepseekAvailable() ? { provider: deepseekProvider, model } : null;
  }
  if (isZhipuModel(model)) {
    return zhipuAvailable() ? { provider: zhipuProvider, model } : null;
  }
  if (isCustomModel(model)) {
    return customAvailable() ? { provider: customProvider, model } : null;
  }
  return null;
}

/**
 * 解析请求模型应走的 provider 与最终模型名。
 * - 云端模型名且对应 key 存在 → 对应云端 provider
 * - 云端模型名但对应 key 缺失 → 回退 ollama 默认模型（保留现有回退行为）
 * - 其余情况（qwen2.5:7b、ollama 自定义模型）→ ollama
 */
export function resolveProvider(model: string): {
  provider: LLMProvider;
  model: string;
} {
  const cloud = resolveCloud(model);
  if (cloud) return cloud;
  if (isDeepSeekModel(model) || isZhipuModel(model) || isCustomModel(model)) {
    return { provider: ollamaProvider, model: DEFAULT_OLLAMA_MODEL };
  }
  return { provider: ollamaProvider, model: model || DEFAULT_OLLAMA_MODEL };
}

/**
 * 拉取前端模型下拉列表：聚合所有可用 provider 的模型。
 * - 云端 provider 有 key：其模型在前，ollama 在线时追加本地模型
 * - 无任何云端 key：仅 ollama 模型（失败返回 available=false 与提示）
 */
export async function getModelList(): Promise<{
  models: ProviderModel[];
  available: boolean;
  message?: string;
}> {
  const candidates: Array<LLMProvider | null> = [
    deepseekAvailable() ? deepseekProvider : null,
    zhipuAvailable() ? zhipuProvider : null,
    customAvailable() ? customProvider : null,
  ];
  const cloudProviders = candidates.filter((p): p is LLMProvider => p !== null);

  const cloudModels = (
    await Promise.all(cloudProviders.map((p) => p.listModels()))
  ).flat();

  const ollamaModels = await ollamaProvider.listModels();
  const models = [...cloudModels, ...ollamaModels];

  if (models.length === 0) {
    return {
      models: [],
      available: false,
      message:
        "未配置任何云端 API Key，且无法连接本地 ollama 服务（默认端口 11434）。",
    };
  }
  if (cloudModels.length > 0 && ollamaModels.length === 0) {
    return {
      models,
      available: true,
      message: "云端模型可用；本地 ollama 未连接。",
    };
  }
  return { models, available: true };
}
