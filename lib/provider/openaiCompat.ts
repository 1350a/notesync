/**
 * OpenAI 兼容 Provider 公共基类
 *
 * DeepSeek / 智谱 AI / 自定义模型均遵循 OpenAI Chat Completion 协议：
 * - 端点：{baseUrl}/chat/completions
 * - 鉴权：Authorization: Bearer <apiKey>
 * - 请求/响应结构与 OpenAI 一致（含 SSE 流式、response_format json_object）
 *
 * 子类只需提供 name、apiKey、baseUrl、默认模型列表与展示名，并声明是否支持
 * GET {baseUrl}/models 在线枚举（probeEnabled）。
 *
 * 模型探测（probe）四态：
 * - unconfigured：apiKey / baseUrl 缺失，不发起任何网络请求
 * - unauthorized：枚举返回 401，Key 无效，推理同样不可用
 * - degraded    ：可用但非理想（不支持枚举 / 403 无权 / 超时 / 枚举为空 / 配置名未命中）
 * - ok          ：在线枚举成功且配置模型名命中（含 name:tag 归一）
 * 探测失败不抛错，一律映射为状态 + 原因，避免污染请求链路。
 *
 * 思考过程（reasoning）支持：
 * - DeepSeek R1 系 / 部分推理模型会在响应中返回 reasoning_content
 *   （非流式 message.reasoning_content，流式 delta.reasoning_content）；
 * - completeDetailed / streamDetailed 透出该字段供前端展示；
 * - complete / streamComplete 保持原签名（仅取 content），内部同样解析 reasoning。
 */
import type {
  CompleteDetailedResult,
  CompleteOptions,
  LLMProvider,
  ModelProbe,
  ModelSource,
  ProviderMessage,
  ProviderModel,
  StreamDelta,
  ThinkingEffort,
  TokenUsage,
} from './types.ts';
import { MAX_ERROR_LOG_CHARS, extractUpstreamMessage, redactUpstreamText } from '../safety/redact.ts';

/**
 * 思考强度 → Provider 请求体参数映射（doc/user-settings.md §2.1，协议预留的两个参数名）。
 * 返回 null 表示本次不携带思考参数（跟随 provider 默认）。
 * - zhipu：GLM 官方口径只有开/关粒度——off 发 disabled，low/medium/high 统一 enabled；
 * - deepseek：reasoning_effort 档位；off 不发送（关闭语义 = 选用非推理模型，由模型下拉承担）；
 * - custom：恒不发送——自定义端点对未知字段可能严格校验（与 user 字段开关同口径）。
 */
export function mapThinkingParam(
  name: 'deepseek' | 'zhipu' | 'custom',
  thinking: ThinkingEffort | undefined,
): Record<string, unknown> | null {
  if (!thinking) return null;
  if (name === 'custom') return null;
  if (name === 'zhipu') {
    return { thinking: { type: thinking === 'off' ? 'disabled' : 'enabled' } };
  }
  // deepseek
  if (thinking === 'off') return null;
  return { reasoning_effort: thinking };
}

/**
 * OpenAI usage 字段 → TokenUsage 归一。
 * 三种上游形态都要能吃：非流式顶层 usage、流式末尾 chunk 的 usage、
 * 以及完全不返回 usage 的实现（返回 undefined，交由调用方标记「上游未提供」）。
 */
export function parseUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const pick = (key: string): number | undefined =>
    typeof record[key] === 'number' ? (record[key] as number) : undefined;
  const promptTokens = pick('prompt_tokens');
  const completionTokens = pick('completion_tokens');
  const totalTokens = pick('total_tokens');
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

/** 单次请求超时（ms） */
const REQUEST_TIMEOUT = 120_000;

/** 模型枚举超时：云端 API（默认 5s） */
export const PROBE_TIMEOUT_CLOUD = 5_000;

/** 模型枚举超时：自定义端点可能走本机 Ollama 等，放宽到 8s */
export const PROBE_TIMEOUT_CUSTOM = 8_000;

export interface OpenAICompatConfig {
  /** Provider 名称（deepseek | zhipu | custom） */
  name: 'deepseek' | 'zhipu' | 'custom';
  /** API Key（为空视为不可用） */
  apiKey: string;
  /** OpenAI 兼容 Base URL（不含 /chat/completions） */
  baseUrl: string;
  /** 默认模型列表（枚举失败时的白名单兜底） */
  defaultModels: string[];
  /** 环境变量配置的首选模型（可选，并入列表并参与归属判断） */
  envModel?: string;
  /** 错误信息与展示用名（如 "DeepSeek"、"智谱 AI"） */
  displayName: string;
  /** 是否允许多模态 image_url 透传（默认 true） */
  allowImages?: boolean;
  /** 是否支持 GET {baseUrl}/models 枚举（默认 false，仅官方提供该端点的子类开启） */
  probeEnabled?: boolean;
  /**
   * 聚焦清单模式（需与 probeEnabled 同时开启）：
   * 在线枚举仅用于健康判定（ok / unauthorized / degraded），模型名始终取静态目录。
   * 适用：端点提供 /models 但枚举清单不完整（如智谱免费款不在枚举结果中）。
   */
  probeHealthOnly?: boolean;
  /** 枚举超时（ms，默认 PROBE_TIMEOUT_CLOUD） */
  probeTimeoutMs?: number;
}

/** 归一模型名：去首尾空格 + 小写，用于名称比较 */
function normalizeModel(name: string): string {
  return name.trim().toLowerCase();
}

/** 去重（保留首次出现的顺序与大小写） */
function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = normalizeModel(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * 模型名三级匹配（配置名 → 枚举实际名），命中返回枚举中的真实名
 * 1) 精确匹配（忽略大小写）
 * 2) 配置名不含冒号时，枚举中唯一以 `配置名:` 开头的项（Ollama 的 name:tag 归一）
 * 3) 配置名含冒号时只走精确匹配，避免 :latest 与 :7b 等 tag 混淆
 */
export function matchModelName(configured: string, remote: string[]): string | null {
  const target = normalizeModel(configured);
  if (!target) return null;
  const exact = remote.find((name) => normalizeModel(name) === target);
  if (exact) return exact;
  if (target.includes(":")) return null;
  const prefixed = remote.filter((name) => normalizeModel(name).startsWith(`${target}:`));
  return prefixed.length === 1 ? prefixed[0] : null;
}

/** 从 /models 响应中提取模型 id，兼容 data[] / models[] / 裸数组 */
function parseModelIds(payload: unknown): string[] {
  const pick = (item: unknown): string | null => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const value = record.id ?? record.name ?? record.model;
      if (typeof value === "string") return value;
    }
    return null;
  };
  const list = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map(pick).filter((v): v is string => Boolean(v));
  };
  if (Array.isArray(payload)) return dedupe(list(payload));
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return dedupe([...list(record.data), ...list(record.models)]);
  }
  return [];
}

export class OpenAICompatProvider implements LLMProvider {
  readonly name: "deepseek" | "zhipu" | "custom";
  readonly displayName: string;
  /** 由 allowImages 决定：上层据此选择图片直传或降级为文字占位 */
  readonly acceptsImages: boolean;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModels: string[];
  private readonly envModel?: string;
  private readonly allowImages: boolean;
  private readonly probeEnabled: boolean;
  private readonly probeHealthOnly: boolean;
  private readonly probeTimeoutMs: number;

  constructor(config: OpenAICompatConfig) {
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.defaultModels = config.defaultModels;
    this.envModel = config.envModel;
    this.displayName = config.displayName;
    this.allowImages = config.allowImages ?? true;
    this.acceptsImages = this.allowImages;
    this.probeEnabled = config.probeEnabled ?? false;
    this.probeHealthOnly = config.probeHealthOnly ?? false;
    this.probeTimeoutMs = config.probeTimeoutMs ?? PROBE_TIMEOUT_CLOUD;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.baseUrl);
  }

  /**
   * 内置白名单兜底列表（枚举失败时的降级来源）。
   * 不并入 envModel：配置名可能是占位符或笔误，兜底阶段把它推成默认选中项，
   * 等于让用户一点必然失败。custom 的白名单本身即配置模型名，不受此影响。
   */
  private whitelistModels(): string[] {
    return dedupe(this.defaultModels);
  }

  private toProviderModel(name: string, source: ModelSource): ProviderModel {
    return {
      name,
      model: name,
      modified_at: new Date().toISOString(),
      size: 0,
      digest: "",
      details: { family: this.name },
      provider: this.name,
      source,
    };
  }

  /**
   * 模型探测：返回真实可用的模型名 + 健康状态。
   * 永不抛错——网络/鉴权/解析异常全部映射为 degraded（401 为 unauthorized）。
   */
  async probe(): Promise<ModelProbe> {
    const configuredModel = this.envModel?.trim() || undefined;

    if (!this.isAvailable()) {
      return {
        status: "unconfigured",
        models: [],
        configuredModel,
        source: "none",
        reason: this.apiKey ? "缺少 BASE_URL 配置" : "缺少 API_KEY 配置",
      };
    }

    if (!this.probeEnabled) {
      return {
        status: "degraded",
        models: this.whitelistModels(),
        configuredModel,
        source: "fallback",
        reason: `${this.displayName} 未提供 /models 枚举端点，使用内置白名单`,
      };
    }

    // 聚焦清单模式：模型名以静态目录为准，枚举只回答「端点与 Key 是否健康」
    if (this.probeHealthOnly) {
      return this.probeCatalogHealth(configuredModel);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
        cache: "no-store",
      });

      if (res.status === 401) {
        // 判定口径：Key 填了就算已配置。Key 是否有效由真实调用暴露，
        // 不在探测阶段把整家 Provider 从下拉里抹掉。
        return {
          status: "unauthorized",
          models: this.whitelistModels(),
          configuredModel,
          source: "fallback",
          reason: `${this.displayName} API Key 无效（HTTP 401），当前为内置白名单，调用会被上游拒绝`,
        };
      }
      if (res.status === 403) {
        return {
          status: "degraded",
          models: this.whitelistModels(),
          configuredModel,
          source: "fallback",
          reason: `${this.displayName} 的 Key 无 /models 读取权限（HTTP 403），使用内置白名单`,
        };
      }
      if (!res.ok) {
        return {
          status: "degraded",
          models: this.whitelistModels(),
          configuredModel,
          source: "fallback",
          reason: `${this.displayName} 模型枚举失败（HTTP ${res.status}）`,
        };
      }

      const ids = parseModelIds(await res.json().catch(() => null));
      if (ids.length === 0) {
        return {
          status: "degraded",
          models: this.whitelistModels(),
          configuredModel,
          source: "fallback",
          reason: `${this.displayName} 模型枚举结果为空`,
        };
      }

      if (!configuredModel) {
        return {
          status: "ok",
          models: ids,
          source: "remote",
          reason: "未配置 CUSTOM_MODEL，使用端点返回的首个模型",
        };
      }

      const hit = matchModelName(configuredModel, ids);
      if (hit) {
        return {
          status: "ok",
          models: dedupe([hit, ...ids]),
          configuredModel,
          source: "remote",
        };
      }
      return {
        status: "degraded",
        models: dedupe([configuredModel, ...ids]),
        configuredModel,
        source: "remote",
        reason: `配置模型 ${configuredModel} 不在枚举结果中，已置顶但仍可能调用失败`,
      };
    } catch {
      const timeout = controller.signal.aborted;
      return {
        status: "degraded",
        models: this.whitelistModels(),
        configuredModel,
        source: "fallback",
        reason: timeout
          ? `${this.displayName} 模型枚举超时（>${this.probeTimeoutMs}ms）`
          : `${this.displayName} 模型枚举网络异常`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 聚焦清单模式的健康探测：在线枚举只判定鉴权与可达性，模型名一律取静态目录。
   * 状态映射（401 / 403 / 网络异常等）与常规探测保持一致，避免两套口径。
   */
  private async probeCatalogHealth(configuredModel?: string): Promise<ModelProbe> {
    const models = this.whitelistModels();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 401) {
        return {
          status: "unauthorized",
          models,
          configuredModel,
          source: "fallback",
          reason: `${this.displayName} API Key 无效（HTTP 401），当前为聚焦清单，调用会被上游拒绝`,
        };
      }
      if (res.status === 403) {
        return {
          status: "degraded",
          models,
          configuredModel,
          source: "fallback",
          reason: `${this.displayName} 的 Key 无 /models 读取权限（HTTP 403），使用聚焦清单`,
        };
      }
      if (!res.ok) {
        return {
          status: "degraded",
          models,
          configuredModel,
          source: "fallback",
          reason: `${this.displayName} 健康检查失败（HTTP ${res.status}），使用聚焦清单`,
        };
      }
      const ids = parseModelIds(await res.json().catch(() => null));
      if (ids.length === 0) {
        return {
          status: "degraded",
          models,
          configuredModel,
          source: "fallback",
          reason: `${this.displayName} 模型枚举结果为空，使用聚焦清单`,
        };
      }
      return {
        status: "ok",
        models,
        configuredModel,
        source: "fallback",
        reason: `${this.displayName} 在线校验通过，展示聚焦模型清单`,
      };
    } catch {
      const timeout = controller.signal.aborted;
      return {
        status: "degraded",
        models,
        configuredModel,
        source: "fallback",
        reason: timeout
          ? `${this.displayName} 健康检查超时（>${this.probeTimeoutMs}ms）`
          : `${this.displayName} 健康检查网络异常，使用聚焦清单`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 模型列表：真实来源为 probe 结果（不再返回纯静态白名单） */
  async listModels(): Promise<ProviderModel[]> {
    const probe = await this.probe();
    return probe.models.map((name) => this.toProviderModel(name, probe.source));
  }

  /**
   * 判断模型名是否属于本 Provider（供路由按模型名归属）
   * 兼容 name:tag 形态：配置了 `deepseek-local` 时，`deepseek-local:latest` 归本 Provider。
   */
  ownsModel(model: string): boolean {
    const target = normalizeModel(model);
    if (!target) return false;
    const candidates = [...this.defaultModels, ...(this.envModel ? [this.envModel] : [])].map(
      normalizeModel
    );
    if (candidates.includes(target)) return true;
    if (!target.includes(":")) return false;
    const base = target.slice(0, target.indexOf(":"));
    return candidates.includes(base);
  }

  private buildBody(options: CompleteOptions, stream: boolean): string {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages as ProviderMessage[],
      stream,
    };
    if (options.json) body.response_format = { type: 'json_object' };
    // 上游终端用户标识（safety-protocol §6）：请求体 user 字段，开关控制携带
    if (options.user && process.env.USER_FIELD_ENABLED !== '0') {
      body.user = options.user;
    }
    // 思考强度档位（doc/user-settings.md §2.1）：custom 不发送（未知字段严格校验风险）
    const thinkingParam = mapThinkingParam(this.name, options.thinking);
    if (thinkingParam) Object.assign(body, thinkingParam);
    // 流式用量（doc/implementation-status.md 偏差项）：OpenAI 协议默认只在非流式返回 usage，
    // 流式必须显式声明 include_usage 才会补一个纯 usage chunk。仅 deepseek 官方文档写明支持，
    // zhipu / custom 一律不发，避免未知字段被严格校验端点拒绝。
    if (stream && this.name === 'deepseek') {
      body.stream_options = { include_usage: true };
    }
    if (options.tools) {
      body.tools = options.tools;
      if (options.toolChoice) body.tool_choice = options.toolChoice;
    }
    if (!this.allowImages) {
      body.messages = (options.messages as ProviderMessage[]).map((m) => ({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content.map((part) => (part.type === 'text' ? part.text : '[图片附件]')).join('\n'),
      }));
    }
    return JSON.stringify(body);
  }

  private async post(options: CompleteOptions, stream: boolean): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    options.signal?.addEventListener('abort', () => controller.abort());
    try {
      return await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: this.buildBody(options, stream),
        signal: controller.signal,
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 上游错误文案。
   *
   * 原文（errText）此前被整段拼进文案，随 error 事件下发到浏览器，里面有
   * request_id、账号信息与内部字段名。现在改为：原文只进服务端日志，
   * 响应侧给「模板化提示 + 脱敏截断的上游 message」。
   *
   * 之所以不把上游语义彻底丢掉：explainProviderError 依赖上游英文关键词判断
   * 「模型不接受图片输入」这类定向提示，摘要必须留下语义。但只取 message 原文，
   * 不贴整段 JSON——上游的 type / param / code 字段既无用又与本地 error.code 混淆。
   */
  private errorMessage(status: number, errText: string): string {
    const raw = (errText || '').trim();
    if (raw) {
      console.error(`[provider] ${this.name} HTTP ${status}：${raw.slice(0, MAX_ERROR_LOG_CHARS)}`);
    }
    const hint =
      status === 401 || status === 403
        ? '鉴权失败，请检查 API Key 是否正确。'
        : status === 402
          ? '上游账户余额或额度不足，请充值后重试。'
          : status === 404
            ? '模型不存在或该 Key 无权访问，请检查模型名称。'
            : status === 429
              ? '请求过于频繁或额度受限，请稍后重试。'
              : status >= 500
                ? '上游服务异常，请稍后重试。'
                : '请求被上游拒绝，请检查 API Key、余额与模型配置。';
    const summary = redactUpstreamText(extractUpstreamMessage(raw));
    return `${this.displayName} 返回错误（HTTP ${status}）：${hint}${
      summary ? `（上游摘要：${summary}）` : ''
    }`;
  }

  /** 解析响应 message/delta 中的内容与思考过程（兼容 reasoning_content / reasoning） */
  private parseReasoning(
    m: { content?: string; reasoning_content?: string; reasoning?: string } | undefined
  ): { content: string; reasoning?: string } {
    const content = m?.content?.trim() || '';
    const reasoning = (m?.reasoning_content ?? m?.reasoning)?.trim() || '';
    return { content, reasoning: reasoning || undefined };
  }

  async complete(options: CompleteOptions): Promise<string> {
    const r = await this.completeRaw(options);
    return r.content;
  }

  /** 详细补全：透出 reasoning 思考过程（供 /api/chat 透传） */
  async completeDetailed(options: CompleteOptions): Promise<CompleteDetailedResult> {
    return this.completeRaw(options);
  }

  private async completeRaw(options: CompleteOptions): Promise<CompleteDetailedResult> {
    const res = await this.post(options, false);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(this.errorMessage(res.status, errText));
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string;
          reasoning_content?: string;
          reasoning?: string;
          tool_calls?: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }[];
      usage?: unknown;
      error?: { message?: string };
    };
    if (data.error?.message) {
      // 流式 body 内的错误同样可能带 request_id / 账号信息：日志留原文，响应留脱敏摘要
      const rawErr = data.error.message;
      console.error(
        `[provider] ${this.name} 流式响应错误：${rawErr.slice(0, MAX_ERROR_LOG_CHARS)}`,
      );
      throw new Error(
        `${this.displayName} 返回错误：${redactUpstreamText(rawErr) || '上游流式响应返回错误'}`,
      );
    }
    const choice = data.choices?.[0];
    const parsed = this.parseReasoning(choice?.message);
    return {
      ...parsed,
      toolCalls: choice?.message?.tool_calls,
      finishReason: choice?.finish_reason,
      usage: parseUsage(data.usage),
    };
  }

  /**
   * 流式补全：解析 OpenAI SSE（data: {...} 增量），逐段 yield 文本增量。
   * DeepSeek / 智谱 / 自定义 OpenAI 兼容端点均支持 stream: true。
   */
  async *streamComplete(options: CompleteOptions): AsyncGenerator<string> {
    for await (const delta of this.streamRaw(options)) {
      if (delta.content) yield delta.content;
    }
  }

  /** 详细流式补全：逐段透出 content / reasoning / toolCall 增量（供 /api/chat SSE 透传） */
  async *streamDetailed(options: CompleteOptions): AsyncGenerator<StreamDelta> {
    yield* this.streamRaw(options);
  }

  private async *streamRaw(options: CompleteOptions): AsyncGenerator<StreamDelta> {
    const res = await this.post(options, true);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(this.errorMessage(res.status, errText));
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error(`${this.displayName} 流式响应缺少 body`);

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: {
              delta?: {
                content?: string;
                reasoning_content?: string;
                reasoning?: string;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string;
            }[];
            usage?: unknown;
          };
          const choice = chunk.choices?.[0];
          // usage 常在 choices 为空的独立 chunk 里下发：必须在下方 `if (!delta) continue`
          // 之前取走，否则会被当成无内容行丢掉（用量归零的根因）
          const streamUsage = parseUsage(chunk.usage);
          if (streamUsage) {
            yield { usage: streamUsage };
          }
          // finish_reason 随流透传（safety-protocol §3：拦截判定需要它；最后一次出现的为准）
          if (choice?.finish_reason) {
            yield { finishReason: choice.finish_reason };
          }
          const delta = choice?.delta;
          if (!delta) continue;
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            yield { content: delta.content };
          }
          const reasoning = delta.reasoning_content ?? delta.reasoning;
          if (typeof reasoning === 'string' && reasoning.length > 0) {
            yield { reasoning };
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              yield {
                toolCall: {
                  index: tc.index,
                  id: tc.id,
                  name: tc.function?.name,
                  argumentsDelta: tc.function?.arguments,
                },
              };
            }
          }
        } catch {
          // 忽略无法解析的数据行
        }
      }
    }
  }
}
