# 工具调用（Tool Calling）协议

> 状态：P1（框架骨架）｜最后更新：2026-11-07
> 对应代码：`lib/tools/`、`lib/provider/types.ts`（仅类型扩展）、`app/api/chat/route.ts`（P4 接线）

本文件是工具调用的**唯一事实来源**。修改协议必须先改本文件，再改代码（见 `AGENTS.md` §9）。

---

## 1. 概述

本项目工具调用**不使用 MCP（Model Context Protocol）**，采用"类 MCP"的进程内方案：

- 工具定义遵循 **MCP 风格**（`name` / `description` / `inputSchema` 为 JSON Schema），便于未来接外部 MCP server 时平滑迁移。
- 工具执行在**服务端进程内**完成，不引入 stdio/HTTP 传输与会话管理。
- 支持**两种模式**（native / text），适配不同能力等级的模型。

## 2. 双模式

| 模式     | 适用                                                         | 特征                                                                 |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `native` | 原生支持 OpenAI tools 协议的模型（DeepSeek、智谱 glm-4+ 等） | 请求体带 `tools`，模型返回结构化 `tool_calls`                        |
| `text`   | 小模型 / 纯文本模型 / 兼容性差的端点                         | 工具清单注入 system prompt，模型用固定围栏输出 JSON 文本，服务端解析 |

两种模式**共享同一套工具定义、执行逻辑、结果回填格式**，差异仅在最外层适配器（`adapters/native.ts` / `adapters/text.ts`，P3 实现）。

## 3. 工具定义（MCP 风格）

```ts
interface ToolDefinition {
  name: string; // 唯一标识，蛇形命名
  description: string; // 给模型看的自然语言描述
  inputSchema: JSONSchemaObject; // JSON Schema 子集
  enabled?: boolean; // 预留：工具级开关，P1 恒 true
}
```

`JSONSchemaObject` 支持最小字段：`type` / `properties` / `required` / `enum` / `minimum` / `maximum` / `minLength` / `maxLength` / `items` / `description`。其余字段保留 `[key: string]: unknown` 索引签名，未来扩展无需破坏类型。

## 4. native 模式

### 4.1 请求

通过 `CompleteOptions.tools` 传入，经 `lib/tools/render.ts` 的 `renderForNative()` 转为 OpenAI 格式：

```json
{
  "type": "function",
  "function": {
    "name": "ask_user",
    "description": "...",
    "parameters": { "type": "object", "properties": {}, "required": [] }
  }
}
```

### 4.2 响应

非流式：`message.tool_calls[]`，每项含 `id` / `type:"function"` / `function.name` / `function.arguments`（**JSON 字符串**）。
流式：`delta.tool_calls[]`，每项含 `index`，`id` / `name` / `arguments` 会分片下发，**必须按 `index` 合并**后再解析 `arguments`。

统一归一化为：

```ts
interface ExtractedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>; // 已解析对象
}
```

## 5. text 模式

### 5.1 请求

不发 `tools` 字段。通过 `renderForText()` 生成说明，**追加到 system prompt 末尾**。

### 5.2 输出格式（强制）

模型调用工具时，只输出下面这一种格式，前后不得有任何额外文字：

````
```tool
{"tool": "ask_user", "arguments": {"question": "你是哪一步不会？"}}
```
````

- 一次只能调用一个工具（P1 先做单工具；多工具解析器预留）。
- 不需要调用工具时，正常用自然语言回答。
- 工具结果回填后，模型会收到一条 `[工具结果] {...}` 的 user 消息。

### 5.3 解析策略

1. 流式累积 content，首个非空 delta 到达时判断：
   - 以 ` ``` ` 或 `{` 开头 → 进入 **buffer 模式**（不 yield content，只累积）
   - 否则 → 进入 **stream 模式**（直接 yield content，即正常回答）
2. buffer 模式结束时：尝试解析围栏内 JSON。
   - 成功 → 产出 `tool_call` 事件，本轮不 yield content。
   - 失败 → 把 buffer 整体 yield 为 content（误判兜底）。
3. 解析失败时**重试一次**：追加 system 消息要求严格按格式输出；再失败则视为普通回答。

### 5.4 解析器容忍度（宽松）

为兼容不同小模型的输出习惯，解析器同时容忍：

- 带 ` ```tool ` 围栏（标准）
- 带 ` ```json ` 围栏
- 裸 JSON（`{"tool":...}` 前后无围栏）
- JSON 前后有少量解释文字（正则提取第一个平衡的 `{...}`）

## 6. 中断语义：`ask_user`

`ask_user` 不是普通工具——它**不产生工具结果**，而是"中断本轮，等待用户回答"。

### 6.1 执行

```
模型发起 ask_user(question)
  → invoke() 返回 { kind: "awaiting_user", question }
  → loop 检测到 → 发 awaiting_user 事件 → 立即发 done（本轮结束）
  → 服务端不落任何 ask_user 的 tool 消息
```

`ToolInvocation` 的完整形态：

```ts
type ToolInvocation =
  | { kind: 'result'; ok: true; data: unknown; summary: string }
  | { kind: 'result'; ok: false; error: string; summary: string }
  | { kind: 'awaiting_user'; question: string };
```

### 6.2 历史回放（下一次请求）

前端在下一轮请求中会带回上一轮的 assistant 消息（含 `ask_user` 的 tool_calls）和用户回答的 user 消息。

服务端在**进入 loop 之前**对历史做一次规范化（`preprocessMessages`）：

| 原始                                                                                  | 转换后                       |
| ------------------------------------------------------------------------------------- | ---------------------------- |
| native: `assistant(tool_calls=[{name:"ask_user", arguments:"{\"question\":\"Q\"}"}])` | `assistant("（询问用户）Q")` |
| text: `assistant(content="```tool\n{\"tool\":\"ask_user\",...}\n```")`                | `assistant("（询问用户）Q")` |

**关键**：转换后**不留任何 `role:"tool"` 的占位消息**，避免违反 OpenAI 协议（有 tool_call 必须有 tool 结果）。

其他工具（非 `ask_user`）的历史照常按 `tool_calls` + `tool` 消息回放。

## 7. SSE 事件扩展（`/api/chat`，P4 接线）

在现有 `reasoning` / `content` / `done` / `error` 基础上新增：

```
event: tool_call     data: {"index":0,"id":"call_x","name":"ask_user","arguments":{"question":"..."}}
event: tool_result   data: {"index":0,"id":"call_x","name":"calculator","ok":true,"summary":"= 42","ms":12}
event: awaiting_user data: {"question":"你是哪一步不会？","toolCallId":"call_x"}
```

- `done` 事件追加 `toolCallsUsed: number`。
- 新增事件对旧前端是**未知事件，会被忽略**，向后兼容。
- `awaiting_user` 发出后必须紧跟 `done`，本轮 SSE 结束。

## 8. 错误语义

- **工具执行失败**（抛错、超时、参数校验失败）：转成 `{ kind: "result"; ok: false; error }`，作为 `role:"tool"` 消息回填，**不中断 loop**。模型可自行决定换工具或直接回答。
- **模型请求失败**（HTTP 4xx/5xx、网络错误）：`error` 事件，结束本轮。与现有 `/api/chat` 行为一致。
- **达到 `maxRounds`（默认 3）仍未收敛**：追加一条 system 提示"请直接回答"后做最后一次不带 tools 的请求，强制收敛。
- **text 模式解析失败重试 1 次仍失败**：视为普通回答，退出 loop。

## 9. 预留扩展点（P1 只预留，不实现）

| 扩展                  | 预留位置                                                                       | 实现代价         |
| --------------------- | ------------------------------------------------------------------------------ | ---------------- |
| 多工具并行调用        | `ExtractedToolCalls.calls[]` 已是数组；`loop` 里 `for` 换 `Promise.allSettled` | 小               |
| 工具级开关            | `ToolDefinition.enabled`                                                       | 小               |
| 外部 MCP server       | `registry.ts` 的 `registerTool` 入口；`render.ts` 的 `renderForNative`         | 中（换数据源）   |
| 工具选择策略          | `CompleteOptions.toolChoice`                                                   | 小               |
| 结构化流式 tool_calls | `StreamDelta.toolCall`                                                         | 已在 P1 类型预留 |

## 10. 变更记录

| 日期       | 阶段 | 说明                                            |
| ---------- | ---- | ----------------------------------------------- |
| 2026-11-07 | P1   | 初版：双模式、`ask_user` 中断语义、SSE 事件定义 |
