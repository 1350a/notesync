/**
 * LLM Provider 层 - 共享类型定义
 *
 * 简易重构版：仅三云端 OpenAI 兼容 Provider（DeepSeek / 智谱 / 自定义），
 * 本地 ollama 与 harness 编排链路已注释停用。
 */

/** Provider 名称（ollama 保留仅为类型兼容，已停用） */
export type ProviderName = "deepseek" | "zhipu" | "custom" | "ollama";

/** 消息中的文本片段 */
export interface ProviderTextPart {
  type: "text";
  text: string;
}

/** 消息中的图片片段（真实图片数据，仅 DeepSeek 支持） */
export interface ProviderImagePart {
  type: "image_url";
  image_url: { url: string };
}

/** 消息内容：纯文本或多模态片段数组 */
export type ProviderContent = string | (ProviderTextPart | ProviderImagePart)[];

/** Provider 消息（OpenAI 兼容形态） */
export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: ProviderContent;
}

/** 补全请求选项 */
export interface CompleteOptions {
  model: string;
  messages: ProviderMessage[];
  /** 请求结构化 JSON 输出 */
  json?: boolean;
  /** 外部取消/超时信号 */
  signal?: AbortSignal;
}

/** 详细补全结果：内容 + 可选思考过程（本地推理模型透传用） */
export interface CompleteDetailedResult {
  content: string;
  /** 模型思考过程（DeepSeek 等返回 reasoning_content / reasoning） */
  reasoning?: string;
}

/** 流式增量：内容片段或思考过程片段（二者至少一个） */
export interface StreamDelta {
  content?: string;
  reasoning?: string;
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
