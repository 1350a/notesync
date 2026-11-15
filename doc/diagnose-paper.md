# 整卷诊断 · API 契约（`POST /api/diagnose-paper`）

> 状态：已实装（四步流程 + SSE 事件 + 两级降级）｜最后更新：2026-11-15
> 对应代码：`app/api/diagnose-paper/route.ts`（编排）、`lib/diagnose/paper.ts`（切题提示词与分类规则）、
> `lib/diagnose/runtime.ts`（`parseSubmission` / `buildDiagnosisResult`，与单题链路共用）、
> `lib/diagnose/completeness.ts`（完整度推导）、`lib/chat/cost.ts`（成本计量）
> 上层协议：`agent-workflow.md` §5（为什么不能串行逐题、四步划分、降级语义）
> 按 `AGENTS.md` §9，改本契约先于改代码。

本文件定义整卷诊断的请求体、SSE 事件序列、四步流程与降级路径。单题诊断走
`POST /api/chat`，契约见 `diagnose-file-intake.md`；两者的 `content_blocked` 语义必须保持一致。

## 1. 范围

| 在范围内 | 不在范围内 |
|---|---|
| 整卷请求体与校验 | 单题诊断（`/api/chat`） |
| SSE 事件字段与顺序 | 前端卡片渲染细节 |
| 四步流程的调用预算 | 错因表与策略卡内容（`diagnosis-model.md`） |
| 切题失败 / 单组失败的降级 | 聚类与语义缓存（挂账，v1 不做） |

## 2. 请求体

```ts
interface PaperRequest {
  /** 指定模型名；缺省取 /api/models 首项，不做静默回落 */
  model?: string;
  /** 试卷附件（图片 / PDF 文字层 / 纯文本），复用单题链路的附件结构 */
  attachments?: DiagnoseAttachment[];
  /** 设备标识，仅用于成本日志；长度 > 64 时丢弃 */
  user?: string;
}
```

- `attachments` 的单项结构与校验规则完全复用 `diagnose-file-intake.md` §5（`parseAttachments`）。
- `attachments` 缺失或全部无效 → 直接发 `error: no_content`，不进入流程。
- `user` 取自 `getUserId()`（localStorage `notesync-user-id`，纯随机 UUID，见 `user-settings.md` §4.1），
  长度 > 64 时服务端丢弃该字段继续流程（不报错）；随 Provider 请求体转发，是否上行受 `USER_FIELD_ENABLED` 控制。
- 请求头 `x-client-id` 只用于日志与成本归集，缺省 `anonymous`，与请求体 `user` 不得混用。

## 3. SSE 事件

```
event: paper_step
data: {"step":"切题中…","progress":"阶段 1/4"}

event: diagnosis
data: {"result":{...},"questionNumbers":["第1题","第3题"],"groupCode":"case_miss"}

event: content
data: {"delta":"..."}

event: done
data: {"finishReason":"paper","stats":{"questions":20,"groups":5}}

event: error
data: {"code":"content_blocked","error":"...","model":"...","provider":"..."}
```

| 事件 | 字段 | 语义 |
|---|---|---|
| `paper_step` | `step`（人读文案）、`progress?`（进度口径文案）、`detail?`、`status?` | 步骤与分组进度。进度一律以**带口径前缀的字符串**下发，不用裸 `current/total`，避免分母被误读成上传文件数：阶段固定为 `阶段 i/4`（4 是四个固定阶段数，与附件数无关），分组为 `第 i/N 组`（N 是本次实际分组数）。**两套分母语义不同，跨阶段不可横向比较**。`status: "failed"` 表示流程在该步终止，前端据此把整个进度块标为「已中断」 |
| `diagnosis` | `result`（`DiagnosisResult`）、`questionNumbers`、`groupCode` | 一组的共享诊断结论。结构复用单题卡片，前端同一套渲染 |
| `content` | `delta` | 汇总正文，一次发出（非增量） |
| `done` | `finishReason` 恒为 `"paper"`、`stats` | 正常收尾，见 §6 |
| `error` | `code`、`error`（人读文案）、`model?`、`provider?` | 失败；`model` / `provider` 仅在 `content_blocked` 时携带 |

事件顺序：若干 `paper_step` → 若干 `diagnosis`（0 到组数条）→ 可选 `content` → `done`；任何 `error` 之后不再有其他事件。

**失败必发终态步骤**：每个 `error` 分支都必须在其之前补发一条 `paper_step`（`status: "failed"`，文案形如「切题失败（流程已中断）」），前端收到后立即把进度块标为「已中断」。禁止只发 `error` 就 `return`——那样前端会停在「切题中…（阶段 1/4）」的处理中观感上。

## 4. 四步流程与调用预算

| 步 | 动作 | 调用 | 说明 |
|---|---|---|---|
| ① 切题 | 附件材料 → 题号 / 题干 / 作答 / 题型 | 1 次，结构化 JSON | `buildSplitPrompt` + `parseSplitResultDetailed`。**切题请求必须携带 `assembleDiagnoseMessage` 组装出的多模态消息 `assembled.message`**：图片本体以 `image_url` parts 上行，或由附件自带的 OCR 文本承载，二者至少有其一；**禁止**把消息拍平成纯文本占位（`[图片]`）后送模型——原图直传档下那等于让模型凭空切题。**JSON 口径必须与 `response_format=json_object` 一致**：提示词要求输出 `{"questions":[...]}` 对象外壳（禁止要求"顶层数组"，二者互斥会让模型折中产出各种外壳）；解析侧 `parseSplitResultDetailed` 兼容 `questions`/`data`/`result`/`items`/`list` 等单键数组外壳，同时保留裸数组，键名不识别而只有一个数组值时兜底取用 |
| ② 分类 | 每题打错因候选标签 | 0 次 | `classifyQuestions` 本地关键词规则，不花 token |
| ③ 同类共享诊断 | 同一错因组只诊断一次 | 每组 1 次 | `buildGroupDiagnosePrompt`，组内共享同一结论 |
| ④ 汇总 | 逐组引用 + 全局统计 | 1 次 | `buildSummaryPrompt`，产出 `content` 事件 |

**调用预算 = 组数 + 2**，成本按该口径记账（`estimateCost({ calls: groups.length + 2 })`），一次 `logCost` 落在 `done` 之后。
成本日志的 `requestChars` 口径为 `assembled.stats.chars + assembled.stats.images`：文本按字符计，图片本体不计字符但按每张 1 字符占位，避免原图直传档恒为 0（显式传 `requestChars` 覆盖 messages 推导值）。

## 5. 降级路径（宁可少做，不可错做）

| 失败点 | 行为 | 事件 |
|---|---|---|
| 切题材料为空（`stats.images === 0 && stats.chars === 0`，即模型不收图且附件没带 OCR 文本） | **不进切题**：这是取材 / 配置问题，先明确告知，不烧一次调用 | `error: no_text_material`，文案提示开启 OCR 或改用支持图片输入的模型 |
| 切题失败：模型输出非 JSON（`not_json`）/ 非列表（`not_array`）/ 空列表（`empty`）/ 无题干（`no_stem`） | **不静默继续**：按原因分层提示改用单题模式，并留 `console.warn` 痕迹（`[paper] 切题失败 reason=… raw=…`，原文经 `redactUpstreamText` 截断脱敏） | `error: provider_error`，文案按原因区分，不再一律归因为「拍照模糊或排版过密」 |
| 单组诊断失败（JSON 校验不过） | 跳过该组并在步骤里留痕，不阻断其他组 | `console.warn` + `paper_step`「组 X 诊断未完成（已跳过）」，继续下一组 |
| 全部组都失败 | 无结论可汇总，整卷不交付 | `error: no_content`，提示重试或改单题模式 |
| 任一补全被上游拦截 | 立即终止整条流，不做后续阶段 | `error: content_blocked`，与 `/api/chat` 同一错误码与文案 |
| 无附件 / 附件无效 | 不进流程 | `error: no_content` |
| 模型不可用 | 不进流程 | `error: no_model` / `invalid_model` |

补全统一经 `complete()` 包装：内部做拦截归一（`isBlockedSignal`），返回 `null` 表示「已被拦截且 error 事件已发」，调用方据此 `return`，不重复发错。

## 6. `done.stats`

| 字段 | 类型 | 说明 |
|---|---|---|
| `questions` | number | 切题得到的题目数 |
| `groups` | number | 分类后的错因组数（调用预算 = `groups + 2`） |
| `mock` | boolean（可选） | 仅 MOCK 剧本下为 `true`，正常路径不出现该字段 |

## 7. MOCK 模式

`MOCK_MODEL === '1'` 时走固定剧本：不探测模型、不碰任何上游，零 token 跑通完整事件序列
（`paper_step` × 4、`diagnosis` × 组数、`content`、`done`），`stats.mock = true`，
所有文案前缀「（MOCK 仿真）」。用于零 token 验证前端渲染与事件顺序。

剧本分支位于 `no_content` 校验之后、模型解析之前，与 `/api/chat` 同序——保证「MOCK 下不打上游」这一性质不依赖模型配置。

## 8. 已知未做

- 题目级逐题 L2：当前整卷只在组级产出结论，逐题引用靠汇总正文承载。
- 错因聚类：`classifyQuestions` 为关键词规则，未接本地嵌入聚类（挂账，见总账 §3）。
- 汇总正文的引用后置校验：`checkAnswerQuote` 只在 `/api/chat` 的 `diagnose` 态执行，整卷汇总未接。
- `route.ts` 体量超出 `AGENTS.md` §2 的约 100 行约束（现 284 行），编排下沉 `lib/` 的重构待排期。
