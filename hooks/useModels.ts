import type { ModelProbeStatus, ProviderModel, ProviderStatus } from '@/lib/provider/types';
import { useCallback, useEffect, useState } from 'react';

/** /api/models 响应（与 app/api/models/route.ts 保持一致） */
interface ModelsResponse {
  models?: ProviderModel[];
  available?: boolean;
  status?: ModelProbeStatus;
  providers?: ProviderStatus[];
  message?: string;
}

export interface UseModelsResult {
  /** 可请求的模型列表（首项为后端推荐的默认模型） */
  models: ProviderModel[];
  /** 各 Provider 明细状态（分组标注与排障用） */
  providers: ProviderStatus[];
  /** 聚合状态：ok / degraded / unauthorized / unconfigured */
  status: ModelProbeStatus;
  /** 是否存在至少一个可请求模型 */
  available: boolean;
  /** 后端给出的提示（配置缺失 / 鉴权失败 / 降级原因） */
  message?: string;
  loading: boolean;
  /** 请求失败（网络 / 服务端异常）时的错误文案 */
  error?: string;
  /** 强制重新探测（跳过服务端 30s 缓存） */
  reload: () => Promise<void>;
}

/**
 * 拉取真实可用模型列表。
 * 不读取 localStorage、不做本地兜底——模型名一律来自 GET /api/models。
 * 首屏加载走 requestModels + then 回调更新状态，避免在 effect 内同步 setState。
 */
export function useModels(): UseModelsResult {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [status, setStatus] = useState<ModelProbeStatus>('unconfigured');
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  /** 纯请求：不触碰任何状态 */
  const requestModels = useCallback(async (refresh: boolean): Promise<ModelsResponse> => {
    const res = await fetch(refresh ? '/api/models?refresh=1' : '/api/models', {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ModelsResponse;
  }, []);

  const applySuccess = useCallback((data: ModelsResponse) => {
    setModels(data.models ?? []);
    setProviders(data.providers ?? []);
    setStatus(data.status ?? 'unconfigured');
    setAvailable(Boolean(data.available));
    setMessage(data.message);
    setError(undefined);
  }, []);

  const applyFailure = useCallback((reason: string) => {
    setModels([]);
    setProviders([]);
    setStatus('unconfigured');
    setAvailable(false);
    setMessage(undefined);
    setError(reason);
  }, []);

  const describeError = (err: unknown): string =>
    err instanceof Error ? `模型列表获取失败：${err.message}` : '模型列表获取失败';

  useEffect(() => {
    let alive = true;
    requestModels(false)
      .then((data) => {
        if (alive) applySuccess(data);
      })
      .catch((err: unknown) => {
        if (alive) applyFailure(describeError(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [requestModels, applySuccess, applyFailure]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      applySuccess(await requestModels(true));
    } catch (err: unknown) {
      applyFailure(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [requestModels, applySuccess, applyFailure]);

  return { models, providers, status, available, message, loading, error, reload };
}
