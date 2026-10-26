/**
 * 错题认知诊断引擎 - 共享类型定义
 */

/** 消息角色 */
export type MessageRole = "user" | "assistant" | "system";

/** 消息附件：支持图片（dataUrl）与 PDF（dataUrl，暂不解析内容） */
export interface Attachment {
  /** 文件名，如 "错题.png" */
  name: string;
  /** MIME 类型，如 image/png、application/pdf */
  type: string;
  /** 附件数据（data URL 或 PDF 文件名占位） */
  dataUrl?: string;
}

/** 单条聊天消息 */
export interface Message {
  id: string;
  role: MessageRole;
  /** 文本内容（纯文字粘贴的错题也存这里） */
  content: string;
  /** 附件列表（图片/PDF） */
  attachments: Attachment[];
  /** 生成时间 */
  createdAt: number;
  /** 使用的模型（assistant 消息记录） */
  model?: string;
}

/** 一个会话（对话分支） */
export interface Conversation {
  id: string;
  /** 会话标题（首条用户消息截断） */
  title: string;
  messages: Message[];
  /** 当前会话使用的 ollama 模型 */
  model: string;
  createdAt: number;
  updatedAt: number;
}

/** ollama 模型信息（/api/tags 返回项） */
export interface OllamaModel {
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

/** /api/models 接口返回 */
export interface ModelsResponse {
  models: OllamaModel[];
  /** ollama 是否可用 */
  available: boolean;
  /** 不可用时的提示信息 */
  message?: string;
}

/** /api/chat 请求体 */
export interface ChatRequest {
  conversationId?: string;
  model: string;
  messages: Message[];
  /** 用户粘贴的纯文字错题（若无附件则作为首条） */
  content?: string;
  attachments?: Attachment[];
}

/** /api/chat 响应体 */
export interface ChatResponse {
  /** AI 回复文本 */
  content: string;
  model?: string;
  error?: string;
}
