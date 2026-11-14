/**
 * 工具适配器接口
 *
 * 屏蔽 native（原生 tools 协议）与 text（系统提示词+围栏解析）的差异，
 * 让 loop.ts 可以完全模式无关地运行。
 */
import type { CompleteOptions, ProviderMessage, StreamDelta, ThinkingEffort } from '@/lib/provider/types.ts';
import type {
  ExtractedToolCall,
  ExtractedToolCalls,
  ToolDefinition,
  ToolInvocation,
} from '../types.ts';

export type ContentCallback = (delta: string) => void;
export type ReasoningCallback = (delta: string) => void;

export interface ToolAdapter {
  /**
   * 构建补全请求。
   * native: 注入 tools 字段；text: 将工具说明追加到 system prompt。
   * user 为上游终端用户标识（可选，safety-protocol.md §6）；
   * thinking 为思考强度档位（可选，doc/user-settings.md §2.1）。
   */
  buildRequest(
    model: string,
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    user?: string,
    thinking?: ThinkingEffort
  ): CompleteOptions;

  /**
   * 消费流式响应。
   * 在遍历流的过程中透传 content 与 reasoning 增量；
   * 若流中包含工具调用，则累积并解析为统一格式返回。
   */
  processStream(
    stream: AsyncGenerator<StreamDelta>,
    onContent: ContentCallback,
    onReasoning: ReasoningCallback
  ): Promise<ExtractedToolCalls>;

  /**
   * 将本轮发起的工具调用与执行结果拼回历史消息。
   *
   * assistantText 为本轮 assistant 已产出的正文（即同一轮内流式下发给用户的文本）。
   * 需要保留正文的适配器（native）必须把它随 tool_calls 一并回填，否则下一轮模型
   * 看不到自己写过什么，会重新生成一份内容，前端同一气泡内出现两份重复正文。
   * 该参数只影响服务端拼装的历史，不参与任何下发，不会导致正文二次显示。
   * 不传/空串时行为与旧版一致（content 置空）。
   */
  appendResults(
    messages: ProviderMessage[],
    calls: ExtractedToolCall[],
    results: ToolInvocation[],
    assistantText?: string
  ): void;

  /**
   * 历史清洗：将上一轮中断的 ask_user 痕迹转换为普通文本，
   * 避免违反 OpenAI 协议（有 tool_calls 必须有 tool 结果）。
   */
  preprocessMessages(messages: ProviderMessage[]): ProviderMessage[];
}
