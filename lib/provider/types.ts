/**
 * LLM Provider 层 - 共享类型定义
 *
 * 简易重构版：仅三云端 OpenAI 兼容 Provider（DeepSeek / 智谱 / 自定义），
 * 本地 ollama 与 harness 编排链路已注释停用。
 *
 * 【工具调用扩展（P1，仅类型）】
 * ProviderMessage 增加 role="tool" 与 tool_calls/tool_call_id/name；
 * CompleteOptions 增加 tools/toolChoice；
 * CompleteDetailedResult 增加 toolCalls/finishReason；
 * StreamDelta 增加 toolCall（流式分片增量）。
 * openaiCompat.ts 的实际请求构造与响应解析在 P4 接线，
 * P1 只扩展类型，不改变现有行为。
 */

/** Provider 名称（ollama 保留仅为类型兼容，已停用） */
export type ProviderName = 'deepseek' | 'zhipu' | 'custom' | 'ollama';

/** 消息角色（tool 为 P1 新增，用于回填工具执行结果） */
export type ProviderRole = 'system' | 'user' | 'assistant' | 'tool';

/** 消息中的文本片段 */
export interface ProviderTextPart {
  type: 'text';
  text: string;
}

/** 消息中的图片片段（真实图片数据，仅 DeepSeek 支持） */
export interface ProviderImagePart {
  type: 'image_url';
  image_url: { url: string };
}

/** 消息内容：纯文本或多模态片段数组 */
export type ProviderContent = string | (ProviderTextPart | ProviderImagePart)[];

/**
 * 模型返回的单条工具调用（OpenAI 协议形态）。
 * 注意：arguments 是 JSON 字符串，不是对象——与 OpenAI 官方一致，
 * 解析前不可直接当对象用（历史回放时必须保持字符串形态）。
 */
export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Provider 消息（OpenAI 兼容形态） */
export interface ProviderMessage {
  role: ProviderRole;
  content: ProviderContent;
  /** assistant 消息中的工具调用列表（native 模式历史回放用） */
  tool_calls?: ProviderToolCall[];
  /** role="tool" 时，对应发起该工具调用的 tool_call.id */
  tool_call_id?: string;
  /** role="tool" 时的工具名（部分端点要求，便于 debug） */
  name?: string;
}

/**
 * native 模式下的工具定义（请求体 tools 数组的元素）。
 * parameters 用 Record<string, unknown> 而非具体 JSON Schema 类型，
 * 保持 provider 层与 tools 层解耦（详见 doc/tool-protocol.md §3）。
 */
export interface NativeToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 补全请求选项 */
export interface CompleteOptions {
  model: string;
  messages: ProviderMessage[];
  /** 请求结构化 JSON 输出 */
  json?: boolean;
  /** 外部取消/超时信号 */
  signal?: AbortSignal;
  /** 工具定义（native 模式）；不传则本次请求无工具调用能力 */
  tools?: NativeToolDef[];
  /** 工具选择策略（默认 "auto"；P1 仅类型预留，P4 接线） */
  toolChoice?: 'auto' | 'none' | 'required';
}

/** 详细补全结果：内容 + 可选思考过程（本地推理模型透传用） */
export interface CompleteDetailedResult {
  content: string;
  /** 模型思考过程（DeepSeek 等返回 reasoning_content / reasoning） */
  reasoning?: string;
  /** native 模式下模型返回的工具调用（非流式） */
  toolCalls?: ProviderToolCall[];
  /** OpenAI finish_reason（"stop" | "tool_calls" | "length" | "content_filter" 等） */
  finishReason?: string;
}

/** 流式增量：内容片段或思考过程片段（二者至少一个） */
export interface StreamDelta {
  content?: string;
  reasoning?: string;
  /**
   * native 模式下的工具调用增量片段（P1 仅类型，P4 实现）。
   * 同一次 tool_call 的 arguments 会切成多个 delta 下发，
   * 调用方必须按 index 累积后再 JSON.parse。
   */
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    /** arguments 增量片段（JSON 字符串的一部分） */
    argumentsDelta?: string;
  };
}

/** 模型信息（用于 /api/models 下拉） */
export interface ProviderModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
  /** 提供该模型的 Provider（前端分组与标注用） */
  provider?: ProviderName;
  /** remote=在线枚举得到的真实模型名，fallback=内置白名单兜底 */
  source?: ModelSource;
  /** 该 Provider 是否接受 image_url 多模态内容（前端据此提示图片是否会被降级为文字占位） */
  acceptsImages?: boolean;
}

/** 模型名来源：在线枚举 / 内置白名单 / 不可用 */
export type ModelSource = "remote" | "fallback" | "none";

/**
 * Provider 模型探测状态（判定顺序：先 unconfigured，再鉴权，再枚举，最后降级）
 * - ok           配置齐全，在线枚举成功，配置模型名命中（可带 canonical 归一）
 * - degraded     可用但非理想：403 无权列出 / 端点不支持枚举 / 超时或网络失败 /
 *                枚举成功但配置名未命中（仍可发请求，由实际调用报错兜底）
 * - unauthorized key 无效（401），推理同样不可用
 * - unconfigured key 或 baseUrl 缺失，不发任何网络请求
 */
export type ModelProbeStatus = "ok" | "degraded" | "unauthorized" | "unconfigured";

/** 单个 Provider 的模型探测结果 */
export interface ModelProbe {
  status: ModelProbeStatus;
  /** 可直接用于请求的模型名（已归一；首项为默认选中项） */
  models: string[];
  /** 环境变量里配置的模型名（未配置时为 undefined） */
  configuredModel?: string;
  source: ModelSource;
  /** 降级/失败原因，供 console 与服务端日志追溯，不透出敏感信息 */
  reason?: string;
}

/** 对外（/api/models）透出的 Provider 状态 */
export interface ProviderStatus {
  name: ProviderName;
  displayName: string;
  status: ModelProbeStatus;
  source: ModelSource;
  /** 该 Provider 返回的模型数量 */
  count: number;
  reason?: string;
}

/** 统一的 LLM Provider 接口 */
export interface LLMProvider {
  readonly name: ProviderName;
  /** 发送补全请求，返回模型输出文本 */
  complete(options: CompleteOptions): Promise<string>;
  /** 流式补全：逐段产出增量文本（未实现时返回 undefined，调用方降级为非流式） */
  streamComplete?(options: CompleteOptions): AsyncGenerator<string>;
  /** 详细补全：返回内容 + 可选思考过程；未实现时调用方降级到 complete */
  completeDetailed?(options: CompleteOptions): Promise<CompleteDetailedResult>;
  /** 详细流式补全：逐段产出内容/思考增量；未实现时调用方降级到 streamComplete */
  streamDetailed?(options: CompleteOptions): AsyncGenerator<StreamDelta>;
  /** 展示名（错误信息与前端标注用） */
  readonly displayName: string;
  /** 拉取可用模型列表；失败返回空数组（不抛错） */
  listModels(): Promise<ProviderModel[]>;
  /** 模型探测：返回可请求的模型名与健康状态（不抛错，异常一律映射为状态） */
  probe(): Promise<ModelProbe>;
  /** 判断模型名是否归属本 Provider（供按模型名路由） */
  ownsModel(model: string): boolean;
  /** 当前 Provider 是否可用 */
  isAvailable(): boolean;
  /**
   * 是否接受多模态 image_url 内容。
   * 不实现的 Provider 视为未知（上层按不支持处理，图片降级为文字占位）。
   */
  readonly acceptsImages?: boolean;
}
