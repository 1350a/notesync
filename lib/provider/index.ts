/**
 * Provider 路由与模型列表聚合
 *
 * - resolveProvider：按模型名归属决定实际 provider；未知模型名返回 null
 *   （由调用方返回 invalid_model，不再静默回落到某家 provider）
 * - getModelList：并发探测三家 provider，聚合真实模型名 + 健康状态，供 /api/models 使用
 *   带 30s 缓存，避免每次打开面板都打满上游 /models
 */
import { deepseekProvider } from "./deepseek";
import { zhipuProvider } from "./zhipu";
import { customProvider } from "./custom";
// 历史遗留：本地 ollama provider 已停用（不再检测本地服务、不再自动回退）
// import { ollamaProvider } from "./ollama";
import type {
  LLMProvider,
  ModelProbeStatus,
  ModelSource,
  ProviderModel,
  ProviderStatus,
} from "./types";

/** 探测结果缓存时长（ms）：同一实例内复用，避免 /api/models 与 /api/chat 重复打上游 */
const PROBE_CACHE_TTL_MS = 30_000;

/** 参与路由与聚合的 provider（顺序即下拉展示顺序） */
const PROVIDERS: LLMProvider[] = [deepseekProvider, zhipuProvider, customProvider];

/** /api/models 返回结构 */
export interface ModelListResult {
  /** 可请求的模型名列表（首项为该 provider 默认选中项） */
  models: ProviderModel[];
  /** 是否至少有一个模型可请求 */
  available: boolean;
  /** 聚合后的整体状态（取三家最优，全不可用取最差） */
  status: ModelProbeStatus;
  /** 各 provider 明细状态（前端分组标注与排障用） */
  providers: ProviderStatus[];
  /** 面向用户的提示（配置缺失 / 鉴权失败 / 降级原因） */
  message?: string;
}

let probeCache: { at: number; value: ModelListResult } | null = null;

/** 按 provider 构造前端下拉项（与基类一致，但不依赖其实例方法） */
function toProviderModel(
  provider: LLMProvider,
  name: string,
  source: ModelSource
): ProviderModel {
  return {
    name,
    model: name,
    modified_at: new Date().toISOString(),
    size: 0,
    digest: "",
    details: { family: provider.name },
    provider: provider.name,
    source,
    acceptsImages: provider.acceptsImages !== false,
  };
}

/** 状态优先级：ok > degraded > unauthorized > unconfigured（用于聚合出整体状态） */
const STATUS_RANK: Record<ModelProbeStatus, number> = {
  ok: 4,
  degraded: 3,
  unauthorized: 2,
  unconfigured: 1,
};

/**
 * 解析请求模型应走的 provider 与最终模型名。
 * - 模型名归属：deepseek / zhipu / custom（支持 name:tag 归一，如 deepseek-local:latest）
 * - 无法归属 → 返回 null，调用方需返回 invalid_model 而不是猜测某家 provider
 */
export function resolveProvider(model: string): {
  provider: LLMProvider;
  model: string;
} | null {
  const target = model.trim();
  if (!target) return null;
  for (const provider of PROVIDERS) {
    if (provider.ownsModel(target)) return { provider, model: target };
  }
  return null;
}

/**
 * 探测并聚合模型列表。
 * @param force 为 true 时跳过缓存（前端手动刷新用）
 */
export async function getModelList(force = false): Promise<ModelListResult> {
  const now = Date.now();
  if (!force && probeCache && now - probeCache.at < PROBE_CACHE_TTL_MS) {
    return probeCache.value;
  }

  const probes = await Promise.all(
    PROVIDERS.map(async (provider) => ({ provider, probe: await provider.probe() }))
  );

  const providers: ProviderStatus[] = probes.map(({ provider, probe }) => ({
    name: provider.name,
    displayName: provider.displayName,
    status: probe.status,
    source: probe.source,
    count: probe.models.length,
    reason: probe.reason,
  }));

  // 按 Provider 健康度排序：ok 优先、degraded 次之、unauthorized 最后。
  // 前端默认选中首个模型，排序后默认即落在真正可用的模型上，
  // 避免用户一进页面就用上 401 的 Provider。
  const probeRank = new Map<string, number>();
  for (const { provider, probe } of probes) {
    probeRank.set(
      provider.name,
      probe.status === "ok" ? 0 : probe.status === "degraded" ? 1 : 2
    );
  }

  const models = probes
    .flatMap(({ provider, probe }) =>
      probe.models.map((name) => toProviderModel(provider, name, probe.source))
    )
    .filter((m) => m.name.length > 0)
    .sort(
      (a, b) =>
        (probeRank.get(a.provider ?? "") ?? 9) - (probeRank.get(b.provider ?? "") ?? 9)
    );

  // 整体状态取三家最优：只要有一家 ok 即整体可用；全部不可用才体现为最差状态
  const status = providers.reduce<ModelProbeStatus>(
    (best, p) => (STATUS_RANK[p.status] > STATUS_RANK[best] ? p.status : best),
    "unconfigured"
  );

  // 仅在整体不可用时给出汇总提示；可用时细节由 providers[] 明细承载，
  // 避免把「某家未配置」这类可选状态当成故障噪音推到前端
  let message: string | undefined;
  if (models.length === 0) {
    const issues = probes.map(
      ({ provider, probe }) => `${provider.displayName}：${probe.reason ?? probe.status}`
    );
    const allUnconfigured = providers.every((p) => p.status === "unconfigured");
    message = allUnconfigured
      ? "未配置任何可用模型。请复制 .env.example 为 .env.local，填写 DEEPSEEK_API_KEY / ZHIPU_API_KEY / CUSTOM_API_KEY+BASE_URL 三者之一后重启服务。"
      : `当前没有可请求的模型。${issues.join("；")}`;
  }

  const value: ModelListResult = {
    models,
    available: models.length > 0,
    status,
    providers,
    message,
  };
  probeCache = { at: now, value };
  return value;
}

/** 清空探测缓存（provider 配置变更或手动刷新时调用） */
export function clearModelListCache(): void {
  probeCache = null;
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
