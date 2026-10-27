/**
 * LLM Provider 层 - 共享类型定义
 *
 * harness（智能多轮对话层）通过统一的 LLMProvider 接口访问
 * DeepSeek 云端与本地 ollama，屏蔽两者在鉴权、端点、多模态上的差异。
 */

/** Provider 名称 */
export type ProviderName = "deepseek" | "ollama";

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
  /** 拉取可用模型列表；失败返回空数组（不抛错） */
  listModels(): Promise<ProviderModel[]>;
  /** 当前 Provider 是否可用 */
  isAvailable(): boolean;
}
