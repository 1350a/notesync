/**
 * 工具层 - 共享类型定义（MCP 风格）
 *
 * 详细协议见 doc/tool-protocol.md。
 *
 * 设计要点：
 * - ToolDefinition 遵循 MCP 风格（name/description/inputSchema），
 *   便于未来接外部 MCP server 时平滑迁移；
 * - JSONSchemaObject 用最小子集 + 索引签名，未来扩展字段不破坏类型；
 * - ToolInvocation 用联合类型区分"普通结果"与"等待用户输入"，
 *   后者是 ask_user 的中断语义（见 doc/tool-protocol.md §6）；
 * - ToolHandlerReturn 是 handler 的返回形态（无 ok 字段），
 *   invoke 统一包装为 ToolInvocation（加 ok/summary/error）；
 * - ExtractedToolCalls.calls 是数组，P1 先做单工具，多工具预留。
 */

/** JSON Schema 最小子集（仅覆盖工具参数校验所需字段） */
export interface JSONSchemaObject {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JSONSchemaObject>;
  required?: string[];
  enum?: (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  items?: JSONSchemaObject;
  // 索引签名：允许未来扩展（oneOf/anyOf/$ref 等）而无需改类型
  [key: string]: unknown;
}

/**
 * ask_user 的单个问题（多问题数组元素，doc/tool-protocol.md §6）。
 * 条数与字段长度限制由 schema 声明，handler 兜底（校验器不校验数组长度）。
 */
export interface AskUserQuestion {
  /** 可选短分类标题（如"身份确认"），前端问题面板展示用 */
  label?: string;
  /** 问题文本 */
  question: string;
  /** 可选预设选项（2~3 个为宜），用户仍可自由输入 */
  options?: string[];
}

/**
 * handler 的返回形态（不含 ok 字段）。
 * - result：普通执行成功，data 由 invoke 序列化后回填模型；
 * - awaiting_user：中断本轮，等用户回答（ask_user 专用）。
 */
export type ToolHandlerReturn =
  { kind: 'result'; data: unknown; summary?: string }
  | { kind: 'awaiting_user'; questions: AskUserQuestion[] };

/**
 * 工具实现签名。
 * - args 已由 invoke 通过 validateArguments 校验，但类型上是 Record<string, unknown>，
 *   handler 内部仍需窄化（如 typeof args.question === "string"）；
 * - handler 不应自行捕获业务异常：抛错由 invoke 统一转为 ok=false 的错误包装。
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolHandlerReturn>;

/** 工具定义（MCP 风格） */
export interface ToolDefinition {
  /** 唯一标识，蛇形命名（如 ask_user） */
  name: string;
  /** 给模型看的自然语言描述 */
  description: string;
  /** 参数 JSON Schema */
  inputSchema: JSONSchemaObject;
  /**
   * 是否启用。P1 恒 true。
   * 工具级开关预留位：未接线的工具必须设为 false 或隐藏，
   * 避免呈现未实现能力（AGENTS.md §8）。
   */
  enabled?: boolean;
  /**
   * 工具实现。P2 起工具应提供 handler 才能被 invoke 执行；
   * 纯声明工具（如未来接外部 MCP server 时，本端只有元数据没有实现）
   * 可省略 handler，此时 invoke 返回"工具未实现"错误。
   */
  handler?: ToolHandler;
}

/** 工具执行上下文（由 loop 注入，工具函数只读） */
export interface ToolContext {
  /** 中止信号（来自路由层的 AbortSignal） */
  signal?: AbortSignal;
  /** 单次执行超时（ms），由 loop 注入 */
  timeoutMs?: number;
}

/**
 * 工具执行结果（invoke 的返回值）。
 * - result/ok=true：普通成功，data 回填给模型，summary 给 SSE 展示；
 * - result/ok=false：执行失败（抛错/超时/校验失败），error 回填给模型；
 * - awaiting_user：中断本轮，等用户回答（仅 ask_user 使用）。
 */
export type ToolInvocation =
  | { kind: 'result'; ok: true; data: unknown; summary: string }
  | { kind: 'result'; ok: false; error: string; summary: string }
  | { kind: 'awaiting_user'; questions: AskUserQuestion[] };

/** 单条工具调用（native 与 text 解析后的统一形态） */
export interface ExtractedToolCall {
  /** 服务端生成或模型返回的调用 ID */
  id: string;
  /** 工具名 */
  name: string;
  /** 已解析的参数对象 */
  arguments: Record<string, unknown>;
}

/** 从模型输出中提取的工具调用集合 */
export interface ExtractedToolCalls {
  /** 调用的工具列表。P1 先做单工具，多工具预留（见 doc §9） */
  calls: ExtractedToolCall[];
  /** 原始输出（debug 与 parseError 诊断用） */
  raw: string;
  /** 解析失败时的诊断信息（为空表示解析成功） */
  parseError?: string;
  /** 上游流终止原因（拦截判定路径之一，wip-safety-protocol.md §3） */
  finishReason?: string;
}

/** 工具调用模式 */
export type ToolMode = 'native' | 'text';

/** loop 产出的流式事件（由 /api/chat 转发为 SSE） */
export type ToolLoopEvent =
  | { type: 'content'; delta: string }
  | { type: 'reasoning'; delta: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | { type: 'tool_result'; id: string; ok: boolean; summary: string; ms: number }
  | { type: 'awaiting_user'; questions: AskUserQuestion[]; toolCallId: string }
  | { type: 'done'; usedRounds: number; finishReason: string }
  /**
   * 上游拦截（content_blocked）：本轮内容不回填历史、请求终止（wip-safety-protocol.md §3.1 硬项）。
   * 循环内检测到即丢弃本轮 assistant 消息——被拒内容回传上游会再拦甚至触发冷却。
   */
  | { type: 'blocked'; signal: 'finish_reason' | 'content'; finishReason?: string }
  /**
   * code 标注错误类别：解析兜底失败为 parse_error，模型请求失败为 provider_error。
   * 未标注时由路由层兜底为 provider_error（doc/tool-protocol.md §8.1）。
   */
  | { type: 'error'; message: string; code?: 'parse_error' | 'provider_error' };
