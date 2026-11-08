# 工具调用（Tool Calling）协议

> 状态：P5（服务端接线完成，前端已消费工具事件）｜最后更新：2026-11-08
> 对应代码：`lib/tools/`（含 `adapters/`）、`lib/provider/types.ts`（仅类型扩展）、`app/api/chat/route.ts`（P4 接线）
>
> 2026-11-07 已按已合入实现（P1–P4 全部落地）逐条校准本文件。校准原则：文档向实现对齐；实现尚未兑现的协议承诺**不删除**，统一收敛到 §8「待实现」与 §9，避免文档声称不存在的能力。

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
  enabled?: boolean; // 工具级开关，缺省 true；false 时 getEnabledTools() 过滤掉
}
```

`JSONSchemaObject` 支持最小字段：`type` / `properties` / `required` / `enum` / `minimum` / `maximum` / `minLength` / `maxLength` / `items` / `description`。其余字段保留 `[key: string]: unknown` 索引签名，未来扩展无需破坏类型。

### 3.1 工具实现（handler）

工具定义中的 `handler` 为可选字段（纯声明工具如未来外部 MCP 反射的工具可省略）。签名：

```ts
type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolHandlerReturn>;

type ToolHandlerReturn =
  { kind: 'result'; data: unknown; summary?: string } | { kind: 'awaiting_user'; question: string };
```

- `kind: "result"` — 普通执行成功。`data` 由 `invoke` 序列化后回填模型；`summary` 可选（不填则自动截断 JSON 字符串到 200 字符，仅供 SSE 展示）。
- `kind: "awaiting_user"` — 中断本轮，等待用户回答（`ask_user` 专用）。
- **不自行捕获业务异常**：抛错由 `invoke` 统一转为 `ok: false` 的错误包装，回填模型而非中断 loop。
- **参数校验由 `invoke` 统一完成**：handler 收到的 `args` 已通过 `validateArguments`，但类型是 `Record<string, unknown>`，handler 内部仍需窄化（`typeof args.x === "string"`）。
- **超时与中止**：`ctx.timeoutMs`（默认 15000）与 `ctx.signal` 由 `invoke` 通过 `Promise.race` 处理；handler 无需关心。

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

同时设置 `CompleteOptions.toolChoice = "auto"`（存在已启用工具时）。这是**显式**声明的，不依赖 provider 默认值。

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

- native 模式：模型可在一条响应中返回**多个** `tool_calls`，`loop` 按数组顺序逐个执行。
- text 模式：一次只能调用一个工具（单围栏解析，多工具解析器预留）。
- 不需要调用工具时，正常用自然语言回答。
- 工具结果回填后，模型会收到一条 `[工具结果] {...}` 的 user 消息。

### 5.3 解析策略

1. 流式累积 content，首个非空 delta 到达时判断：
   - 以 ` ``` ` 或 `{` 开头 → 进入 **buffer 模式**（不 yield content，只累积）
   - 否则 → 进入 **stream 模式**（直接 yield content，即正常回答）
2. buffer 模式结束时：尝试解析围栏内 JSON。
   - 成功 → 产出 `tool_call` 事件，本轮不 yield content。
   - 失败 → 把 buffer 整体 yield 为 content（误判兜底）。
3. 解析失败时**重试 1 次**（P1 承诺已兑现）：
   - `TextAdapter` 解析失败时**不回吐 buffer**，只返回 `parseError` 与 `raw`，由 `loop` 统一裁决；
   - `loop` 首次遇到 `parseError` 时按原消息重发一次请求（重试不消耗轮数，全程最多 1 次）；
   - 重试仍失败：`raw` 非空 → 把 `raw` 整体作为正文产出（视为普通回答），`finishReason='stop'`；
     `raw` 为空（如 native 参数 JSON 损坏且无正文）→ 发 `code='parse_error'` 的 `error` 事件并结束本轮。
   - 早期"正文已吐出 + 又发 error"并存的问题已消除。

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

### 6.3 历史清洗（P3 适配器实现）

为防止带有 `ask_user` 的 `assistant` 消息在后续请求中违反协议，适配器层（`native.ts` / `text.ts`）提供 `preprocessMessages`：

- **native 模式**：扫描 `assistant.tool_calls`。如果包含 `name === "ask_user"`：
  1. 解析 `function.arguments` 中的 `question`。
  2. 构造一条纯文本消息：`{ role: "assistant", content: "（询问用户）" + question }`。
  3. 丢弃 `tool_calls` 字段。
  4. （由于服务端不落 tool 结果，历史中必然没有对应的 `role:"tool"` 消息，直接替换即可）。
- **text 模式**：扫描 `assistant.content`。如果匹配到围栏 ` ```tool ` 且内部 JSON 的 `tool === "ask_user"`：
  1. 提取 `question`。
  2. 将整条消息替换为：`{ role: "assistant", content: "（询问用户）" + question }`。

**目的**：让模型在下一轮看到的历史是“我向用户提问了，用户回答了”，而不是“我生成了不知所谓的工具标记”。

## 7. SSE 事件扩展（`/api/chat`，P4 接线）

在现有 `reasoning` / `content` / `done` / `error` 基础上新增三个事件。**以下字段与 `app/api/chat/route.ts` 的实际下发完全一致**（P4 校准：早期草案中的 `index` 字段并不存在，`tool_result` 也不携带 `name`，前端不要依赖）。

```
event: reasoning    data: {"delta":"思考过程增量"}
event: content      data: {"delta":"回复内容增量"}
event: tool_call    data: {"id":"call_x","name":"ask_user","arguments":{"question":"..."}}
event: tool_result  data: {"id":"call_x","ok":true,"summary":"= 42","ms":12}
event: awaiting_user data: {"question":"你是哪一步不会？","toolCallId":"call_x"}
event: done         data: {"model":"deepseek-chat","provider":"deepseek","usedRounds":1,"finishReason":"stop"}
event: error        data: {"code":"provider_error","error":"...","model":"...","provider":"..."}
```

| 事件            | 字段                                              | 说明                                                       |
| --------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `tool_call`     | `id` / `name` / `arguments`（已解析对象）         | 顺序与模型返回一致；native 多调用时逐条下发                |
| `tool_result`   | `id` / `ok` / `summary` / `ms`                    | `summary` 由 handler 提供，缺省为 JSON 前 200 字符         |
| `awaiting_user` | `question` / `toolCallId`                         | 发出后**必须紧跟 `done`**，本轮 SSE 结束                   |
| `done`          | `model` / `provider` / `usedRounds` / `finishReason` | `finishReason` ∈ `stop` / `awaiting_user` / `max_rounds` |
| `error`         | `code` / `error` / `model`? / `provider`? / `available`? | 见 §8；`code` 现在必有值（loop 内 `parse_error`，其余由路由层兜底 `provider_error`） |

- 新增事件对旧前端是**未知事件，会被忽略**，向后兼容。

## 8. 错误语义

### 8.1 error.code 取值

`code` 由路由层在**请求前校验**与**未捕获异常**两处产生：

| code             | 触发条件                                         | 附加字段        |
| ---------------- | ------------------------------------------------ | --------------- |
| `no_model`       | 未配置任何可用模型                               | —               |
| `invalid_model`  | 请求的模型名不属于任何已配置 Provider（不静默回落） | `available[]`   |
| `unconfigured`   | 归属 Provider 的 API_KEY / BASE_URL 缺失         | `model` / `provider` |
| `provider_error` | 上游错误（401、模型不存在、网络异常等，含 catch 兜底） | `model` / `provider` |

**code 覆盖**：loop 内部错误现已全部带 `code`——解析兜底失败为 `parse_error`，模型请求失败为 `provider_error`；路由层对未标注 `code` 的 error 事件一律兜底为 `provider_error`（见 `app/api/chat/route.ts`）。前端仍建议对未知 `code` 值有兜底文案。

### 8.2 执行期错误

- **工具执行失败**（抛错、超时、参数校验失败）：转成 `{ kind: "result"; ok: false; error }`，作为 `role:"tool"` 消息回填，**不中断 loop**。模型可自行决定换工具或直接回答。
- **模型请求失败**（HTTP 4xx/5xx、网络错误）：`error` 事件，结束本轮（不开 `done`）。

### 8.3 已兑现的 P1 承诺（2026-11-08 落地）

| 项                          | 实现                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| text 模式解析失败兜底       | 重试 1 次（不消耗轮数）；仍失败视为普通回答（`raw` 回吐为正文）；`raw` 为空则发 `parse_error`（详见 §5.3）                   |
| `maxRounds` 强制收敛        | 达到上限后追加 system 提示"直接回答"，再做一次**不带 tools** 的请求；收敛成功仍报 `finishReason='max_rounds'`，收敛请求失败发 `error`（不开 `done`，与 §8.2 一致） |
| `error.code` 覆盖 loop 内部 | loop 内标注 `parse_error` / `provider_error`，路由层对未标注值兜底 `provider_error`，error 事件必有 `code`（见 §8.1）        |

## 9. 扩展点与实现状态

| 扩展                  | 现状                                                                        | 状态         |
| --------------------- | --------------------------------------------------------------------------- | ------------ |
| 多工具调用（顺序）    | native 已支持一条响应多个 `tool_calls`，`loop` 按序串行执行                  | 已实现       |
| 多工具并行调用        | `loop` 里 `for` 换 `Promise.allSettled` 即可                                | 未实现（小） |
| 工具级开关            | `getEnabledTools()` 按 `enabled !== false` 过滤                             | 已实现       |
| 工具总开关            | 环境变量 `TOOLS_ENABLED=false` 时传空工具集                                 | 已实现       |
| 工具选择策略          | native 请求显式设置 `toolChoice: "auto"`                                    | 已实现       |
| 外部 MCP server       | `registry.ts` 的 `registerTool` 入口；`render.ts` 的 `renderForNative`      | 未实现（中） |
| 结构化流式 tool_calls | `StreamDelta.toolCall` + native 适配器按 `index` 合并                       | 已实现       |

## 10. 变更记录

| 日期       | 阶段 | 说明                                            |
| ---------- | ---- | ----------------------------------------------- |
| 2026-11-07 | P1   | 初版：双模式、`ask_user` 中断语义、SSE 事件定义 |
| 2026-11-07 | P4   | 按已合入实现校准：删除不存在的 `index` 字段、`tool_result` 去掉 `name`、`done` 补 `model`/`provider`、新增 §8.1 `error.code` 四态与 §8.3 待实现清单；§9 改为「扩展点与实现状态」 |
| 2026-11-08 | P5   | §8.3 三项落地：text 解析失败重试一次后视为普通回答、`maxRounds` 收敛请求（不带 tools）、error 事件全量带 `code`；前端消费 `tool_call`/`tool_result`/`awaiting_user`，状态推进到 P5 |
