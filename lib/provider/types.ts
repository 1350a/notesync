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
  /** 拉取可用模型列表；失败返回空数组（不抛错） */
  listModels(): Promise<ProviderModel[]>;
  /** 当前 Provider 是否可用 */
  isAvailable(): boolean;
}
