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
// 历史遗留：本地 ollama provider 已停用（不再检测本地服务、不再自动回退）
// import { ollamaProvider } from "./ollama";
import type { LLMProvider, ProviderModel } from "./types";

/**
 * 默认模型常量（历史遗留命名）。
 * 简易重构后不再回退 ollama，此值仅作为“未显式指定模型时的默认云端模型”兜底；
 * 保留导出是为了兼容 lib/harness 等历史引用的编译。
 * @deprecated 新链路请通过 /api/models 获取可用模型，不要依赖本常量
 */
export const DEFAULT_OLLAMA_MODEL = "deepseek-v4-flash";

/** 解析模型名对应的云端 provider（DeepSeek / 智谱 / 自定义） */
function resolveCloud(model: string): { provider: LLMProvider; model: string } | null {
  if (isDeepSeekModel(model)) {
    return { provider: deepseekProvider, model };
  }
  if (isZhipuModel(model)) {
    return { provider: zhipuProvider, model };
  }
  if (isCustomModel(model)) {
    return { provider: customProvider, model };
  }
  return null;
}

/**
 * 解析请求模型应走的 provider 与最终模型名（简易重构版）。
 * 与 .env.example / AGENTS.md 一致：三选一（DeepSeek / 智谱 / 自定义 OpenAI 兼容），
 * 不检测本地 ollama、不自动回退。
 * - 云端模型名 → 对应云端 provider（key 缺失时 isAvailable()===false，
 *   由调用方检查并给出明确错误/401 提示）
 * - 未知模型名 → 以 deepseekProvider 占位（同样由调用方按 isAvailable 处理）
 */
export function resolveProvider(model: string): {
  provider: LLMProvider;
  model: string;
} {
  const cloud = resolveCloud(model);
  if (cloud) return cloud;
  return { provider: deepseekProvider, model: model || DEFAULT_OLLAMA_MODEL };
}

/**
 * 拉取前端模型下拉列表（简易重构版）：聚合三个云端 provider 的模型。
 * - 配置了 key 的 provider 模型在前
 * - 未配置任何 key：返回 available=false 与明确的配置缺失提示（不再探测 ollama）
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

  const models = (
    await Promise.all(cloudProviders.map((p) => p.listModels()))
  ).flat();

  if (models.length === 0) {
    return {
      models: [],
      available: false,
      message:
        "未配置任何模型 API Key。请复制 .env.example 为 .env.local，并填写 DEEPSEEK_API_KEY / ZHIPU_API_KEY / CUSTOM_API_KEY 三者之一后再试。",
    };
  }
  return { models, available: true };
}

/* =====================================================================
 * 【历史遗留代码 - 已注释停用，保留原文便于恢复】
 * 原实现要点（简易重构前）：
 * - import { ollamaProvider } from "./ollama";
 * - export const DEFAULT_OLLAMA_MODEL = "deepseek-local";
 * - resolveProvider：云端模型 key 缺失时自动回退 ollama 默认模型；其余情况走 ollama
 * - getModelList：聚合云端模型 + ollama 模型；无任何云端 key 时探测本地 ollama（localhost:11434）
 * 简易重构后不再检测本地 ollama、不自动回退，遵循 AGENTS.md 三选一规范。
 * ===================================================================== */
