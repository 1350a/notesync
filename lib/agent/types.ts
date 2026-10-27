/**
 * Agent 层 - 共享类型定义
 *
 * 模型在每轮以"决策 JSON"驱动工作流：
 * - action=tools：需要检索知识库/查案例/生成计划（随后执行工具并把结果回填上下文）
 * - action=question：信息不足，向用户追问
 * - action=answer：信息充分，进入最终诊断（正文走流式生成）
 */

/** Agent 工具名 */
export type AgentToolName = "query_knowledge" | "find_similar_problems" | "generate_review_plan";

/** 模型发起的工具调用 */
export interface AgentToolCall {
  name: AgentToolName;
  arguments: Record<string, unknown>;
}

/** 模型决策输出（JSON 解析后的结构） */
export interface AgentDecision {
  action: "tools" | "question" | "answer";
  /** question 阶段的追问问题 */
  questions?: string[];
  /** tools 阶段的工具调用列表 */
  tool_calls?: AgentToolCall[];
  /** 图片内容一句话摘要（跨轮记忆） */
  image_summary?: string;
  /** answer 阶段的规划说明（正文另行流式生成） */
  plan?: string;
}

/** 工具定义（注入系统提示词） */
export interface AgentToolDef {
  name: AgentToolName;
  description: string;
  /** 参数 JSON Schema 简写（自然语言） */
  parameters: string;
}

/** 思考步骤（前端可视化） */
export interface ThinkingStep {
  type: "status" | "tool" | "rag";
  /** 人类可读的过程描述 */
  message: string;
  /** type=tool 时使用的工具名 */
  tool?: string;
  /** type=tool 时的工具参数 */
  args?: Record<string, unknown>;
  /** type=tool 时的工具结果摘要 */
  result?: string;
  /** type=rag 时命中的知识来源标题 */
  sources?: string[];
}
