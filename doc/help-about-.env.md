---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 0389a83fdf2fd477e56fb14bde9a8feb_ecc8846bdf3211f19919525400638852
    ReservedCode1: gkObISWeyJj1Rf2phF7gTGM4OXr6ow+JUFL9zOBuooReV/QS/daskSKDJVqhDPOhDFNlmChpRngVrDxuwHzWR+//K6aS7NhMy/elo4VPQf/KWwtcGi7qC8fRq6tmKVhr60+zGa8nX88qow92PiBnkuzueiPVaHTWpxjhBzOBbsn4ceNLEV1RaP4u57A=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 0389a83fdf2fd477e56fb14bde9a8feb_ecc8846bdf3211f19919525400638852
    ReservedCode2: gkObISWeyJj1Rf2phF7gTGM4OXr6ow+JUFL9zOBuooReV/QS/daskSKDJVqhDPOhDFNlmChpRngVrDxuwHzWR+//K6aS7NhMy/elo4VPQf/KWwtcGi7qC8fRq6tmKVhr60+zGa8nX88qow92PiBnkuzueiPVaHTWpxjhBzOBbsn4ceNLEV1RaP4u57A=
---





# 环境变量说明（help-about-.env）

> 状态：v1（已与 `dev` 分支 HEAD 代码逐条核对）｜最后更新：2026-11-13
> 对应代码：`lib/provider/deepseek.ts`、`lib/provider/zhipu.ts`、`lib/provider/custom.ts`、
> `lib/provider/openaiCompat.ts`、`lib/provider/index.ts`、`app/api/chat/route.ts`、
> `app/api/diagnose-paper/route.ts`、`app/api/ocr/route.ts`、`lib/chat/trim.ts`、`lib/mock/chat.ts`
> 对应模板：`.env.example`（只保留极简标注，语义以本文件为准）

本文是 notesync 全部环境变量的**唯一说明来源**。`.env.example` 只保留变量名、示例值与分组标题，
任何"这个值填什么、为什么这么填"的问题都在本文件回答（`AGENTS.md` §9 协议先行）。

## 1. 定位与用法

- **不是配置中心，只是启动期注入**：所有变量在服务进程启动时读取一次，改完必须重启
  `npm run dev` / `npm start`；运行中修改不生效（设置页里的偏好走 localStorage，与本文件无关，
  见 `doc/user-settings.md`）。
- **加载顺序**：Next.js（`@next/env`）依次加载 `.env`、`.env.local`、`.env.development` 等，
  同名变量**`.env.local` 优先级更高**。因此推荐：

  ```bash
  cp .env.example .env.local   # Windows: copy .env.example .env.local
  ```

- **密钥边界**：`.gitignore` 已忽略 `.env*`，密钥只从服务端环境变量读取，禁止写入客户端代码或
  存储（`AGENTS.md` §7）。`.env.example` 里的 `your_xxx_api_key` 全是占位符，不填也能启动，
  只是对应 Provider 不可用。
- **最小可用**：三家 Provider 任选一家配齐即可对话（配齐 = 有 API Key + 有可解析的 Base URL）。
  三家全空时 `/api/chat` 返回 `no_model`，界面提示去填 `.env.local`。
- **本文不覆盖 `.env` 实际文件**：`.env` / `.env.local` 是本地私产，说明文档不记录任何真实密钥。

## 2. 变量总表

`.env.example` 共 27 个变量：18 个生效（含 3 个 MOCK 调试开关）+ 9 个已停用的历史遗留（注释保留）。

| 变量 | 分组 | 必填性 | 默认值 | 取值 / 示例 |
| --- | --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | Provider | 三选一 | 空（不可用） | `sk-...` |
| `DEEPSEEK_BASE_URL` | Provider | 可选 | `https://api.deepseek.com` | OpenAI 兼容根路径 |
| `DEEPSEEK_MODEL` | Provider | 可选 | 空（取 `/models` 枚举） | `deepseek-flash`（勿填 `deepseek-v4-flash`，见 §9） |
| `ZHIPU_API_KEY` | Provider | 三选一 | 空（不可用） | 智谱 API Key |
| `ZHIPU_BASE_URL` | Provider | 可选 | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容根路径 |
| `ZHIPU_MODEL` | Provider | 可选 | 空（下拉首项） | `glm-5.3` |
| `CUSTOM_API_KEY` | Provider | 用 custom 时必填 | 空（不可用） | 任意非空串（本机端点可填占位） |
| `CUSTOM_BASE_URL` | Provider | **用 custom 时必填，无默认** | 空（不可用） | `http://localhost:11434/v1` |
| `CUSTOM_MODEL` | Provider | 可选 | 空（取 `/models` 枚举） | `qwen3:8b` |
| `TOOLS_ENABLED` | 工具调用 | 可选 | `true` | 仅 `false` 关闭 |
| `TOOL_MAX_ROUNDS` | 工具调用 | 可选 | `3` | 正整数 |
| `CUSTOM_TOOL_MODE` | 工具调用 | 可选 | `native` | `native` / `text` |
| `CUSTOM_ALLOW_IMAGES` | 工具调用 | 可选 | `0`（false） | 仅 `1` 开启 |
| `TRIM_BUDGET_CHARS` | 上下文 | 可选 | `24000` | 字符数；`0` 禁用裁剪 |
| `USER_FIELD_ENABLED` | 请求透传 | 可选 | 开启 | 仅 `0` 关闭 |
| `MOCK_MODEL` | 调试 | 可选 | 关闭 | 仅 `1` 开启 |
| `MOCK_IMAGE_MODE` | 调试 | 可选 | 空（自动） | `text-only` 强制降级 |
| `MOCK_OCR` | 调试 | 可选 | 关闭 | 仅 `1` 开启 |
| 其余 9 个（`OCR_MODE` 等） | 历史遗留 | 不生效 | — | 见 §7 |

## 3. Provider 配置

三家 Provider 共用一套 OpenAI Chat Completion 协议适配（`lib/provider/openaiCompat.ts`）：
端点恒为 `{BASE_URL}/chat/completions`，鉴权恒为 `Authorization: Bearer <API_KEY>`，
请求超时固定 120s（写死在代码里，**不再受** `REQUEST_TIMEOUT_MS` 影响，见 §7）。

### 3.1 DeepSeek

| 项 | 说明 |
| --- | --- |
| 获取 Key | 开放平台 <https://platform.deepseek.com> → API keys |
| 可用性判定 | `DEEPSEEK_API_KEY` 非空即视为可用（`deepseekAvailable()`） |
| 模型来源 | 正常走 `GET /models` 在线枚举；枚举失败时回落白名单 `deepseek-flash`、`deepseek-v4-pro` |
| 图片能力 | 按模型名判定，**名字含 `flash` 或 `vision` 才直传**（`deepseek-flash` 属官方 Vision 款）；`deepseek-v4-pro` 为纯文本，直传 `image_url` 会被上游 400，故走 OCR 转文字（引擎默认云端 glm-ocr，可切本地，`doc/browser-local-ocr.md` §6.1） |

- `DEEPSEEK_MODEL` 是**可选首选模型**：填了会置顶并参与模型名归属校验，不填则由下拉枚举决定。
- 模板示例值用主线名 `deepseek-flash`。**不要**再填 `deepseek-v4-flash`：它曾是过渡别名，
  现已从代码中移除（`lib/provider/deepseek.ts` 不再保留旧名常量），既不在白名单
  （`DEEPSEEK_MODELS`，`lib/provider/deepseek.ts:21`）内，官方 `GET /models` 也不再枚举
  （2026-11-13 实测仅返回 `deepseek-flash`、`deepseek-v4-pro`），填了下拉里看不到、能否调通取决于上游兼容层。
  旧名 `deepseek-chat` / `deepseek-reasoner` 自 2026-07-24 起弃用，同样勿填。
- 健康探测超时 5s（`PROBE_TIMEOUT_CLOUD`）。

### 3.2 智谱 AI / BigModel

| 项 | 说明 |
| --- | --- |
| 获取 Key | 控制台 <https://open.bigmodel.cn> → API Keys（同一 Key 同时供聊天与云端 OCR 使用） |
| 可用性判定 | `ZHIPU_API_KEY` 非空即视为可用（`zhipuAvailable()`） |
| 模型来源 | **下拉固定来自聚焦目录**（`ZHIPU_CATALOG`），不采用 `/models` 枚举结果 |
| 目录内容 | `glm-5.3`（纯文本）、`glm-5.3-flash`（视觉）、`glm-5.3-flashx`（视觉）、`glm-4.7-flash`（免费纯文本） |
| 图片能力 | 目录标注 `vision: true` 的模型才直传；目录外模型一律按纯文本处理，宁可降级也不要上游 400 |

- 官方 `/models` 枚举存在但不完整（免费款 `glm-4.7-flash` 不在列表内），因此探测只用于健康判定
  （`probeHealthOnly`），模型名始终以聚焦目录为准。
- `ZHIPU_MODEL` 填了只影响归属校验与置顶，**不会**让目录外模型出现在下拉里；要新增下拉项必须改
  `ZHIPU_CATALOG`。
- 云端 OCR（`glm-ocr`，走 `{ZHIPU_BASE_URL}/layout_parsing`）**复用** `ZHIPU_API_KEY`，不新增变量
  （`doc/cloud-ocr.md` §2）。

### 3.3 自定义模型（OpenAI 兼容）

| 项 | 说明 |
| --- | --- |
| 获取 Key | 无统一入口；本机 Ollama / vLLM 可填任意非空占位（如 `ollama`），云端服务填其真实 Key |
| 可用性判定 | **Key 与 Base URL 同时非空**才算可用（`customAvailable()`） |
| Base URL | 无默认值，必须显式配置；本地 Ollama 示例 `http://localhost:11434/v1` |
| 模型来源 | 支持 `GET /models` 的端点自动枚举；`CUSTOM_MODEL` 仅用于置顶与校验 |

- 健康探测超时放宽到 8s（`PROBE_TIMEOUT_CUSTOM`），因为本地推理服务启动慢、冷加载更久。
- 该 Provider **不发送**思考强度参数（自定义端点对未知字段可能严格校验，与 `user` 字段同口径，
  见 `doc/user-settings.md` §2.1）。
- 图片是否直传由 `CUSTOM_ALLOW_IMAGES` 决定，详见 §4.4。

### 3.4 可用性判定与模型归属（三家共用规则）

- `/api/models` 并发探测三家，结果聚合为 `models`（可请求模型名）、`status`（`ok` > `degraded` >
  `unauthorized` > `unconfigured`）、`providers`（逐家明细）与可选 `message`；带 30s 缓存。
- 请求按**模型名归属**路由到 Provider（`resolveProvider`），无法归属直接返回 `invalid_model`，
  **不再静默回落**到某一家。`*_MODEL` 配置值因此有第二个作用：把自定义模型名纳入该家归属范围。
- 兼容 `name:tag` 形态：配置 `deepseek-local` 时 `deepseek-local:latest` 也归该 Provider。
- 历史遗留的本地 ollama Provider 已停用（不再自动探测本地服务、不再自动回退）。

## 4. 工具调用配置

### 4.1 `TOOLS_ENABLED`（默认 `true`）

总开关。判定口径是 `process.env.TOOLS_ENABLED !== 'false'`——**只有字符串 `false` 才关闭**，
`0`、`no`、`off`、空值都会被当作开启。关闭后 `getEnabledTools()` 返回空集，模型拿到的是无工具
请求体。

### 4.2 `TOOL_MAX_ROUNDS`（默认 `3`）

单轮对话内工具执行的最大循环轮数，防无限循环。达上限后走"收敛请求"（追加 system 提示再做一次
不带 tools 的请求），因此它是**轮数兜底而非诊断完成**（`doc/agent-workflow.md` §4）。

- 解析用 `parseInt`：非法值得到 `NaN`，比较恒假 → 等价于 0 轮，即**工具一个都不执行**。填就填正整数。
- 诊断模式的 `submit_diagnosis` 是逐请求工厂件（提交存储随请求走，避免并发覆盖），不参与注册表单例。

### 4.3 `CUSTOM_TOOL_MODE`（默认 `native`）

自定义模型的工具调用协议：`native` 走原生 `tools` 字段，`text` 走文本 JSON 协议（适配不支持
`tools` 的端点）。判定是严格相等：`provider.name === 'custom' && CUSTOM_TOOL_MODE === 'text'`
唯一条件，**只对 custom 生效**，其它 Provider 恒 `native`。

> 排查提示：text 模式"没生效"时先确认 mode 是否真的切到 text，再谈模型能力
> （`doc/agent-workflow.md` §6 工具调用模式现状）。

### 4.4 `CUSTOM_ALLOW_IMAGES`（默认 `0` = false）

自定义端点是否接受图片直传，判定口径为严格 `=== '1'`；不设置 / `=0` / 其它任意值一律 false。

- `false`（默认）：该 Provider 的 `acceptsImages` 为 false，图片**不**以 `image_url` 直传，而是先经
  浏览器本地 OCR 转文字（`imageTexts`）再随纯文本发送——纯文本端点也能"看到"图片内容。
- `true`：真多模态端点（如自建视觉模型）才开启；对纯文本端点误设 `1` 会让上游返回 400。
- 不设则对真多模态端点白白丢失原图信息（只剩 OCR 文本）。
- 与 DeepSeek/智谱的模型级判定**正交**：那两家的图片能力由模型名/目录决定，不看这个变量。
- 协议细节：`doc/browser-local-ocr.md` §6.3。

## 5. 上下文与请求透传

### 5.1 `TRIM_BUDGET_CHARS`（默认 `24000`，约 12k token 量级）

长会话上下文裁剪的**字符**预算（不是 token）。超预算时从最旧一侧丢弃非最新用户消息，并在裁剪点
插入一行省略提示，不静默截断；最新一条用户消息永不裁，system 消息不在裁剪范围
（`lib/chat/trim.ts`，总账 §9.1）。

- `0` = **禁用裁剪**（全文上行，注意费用与上下文上限）。
- 非法值 / 负数 → 回落 24000。
- 裁剪发生在 `buildProviderMessages` 之后、`runToolLoop` 之前，命中时服务端打印一条
  `[chat] 会话超预算，裁剪 N 条早期消息` 警告。

### 5.2 `USER_FIELD_ENABLED`（默认开启）

是否在请求体携带上游终端用户标识 `user` 字段（匿名客户端标识，仅日志追溯用，不参与路由/存储，
`doc/safety-protocol.md` §6、`doc/user-settings.md` §4）。

- 判定口径：仅 `USER_FIELD_ENABLED=0` 视为关闭，不设置 / `=1` / 其它任意值一律按开启处理。
- 关闭场景：部分自定义 OpenAI 兼容端点对未知字段严格校验，返回 400 时先关掉它再排查。
- 该字段随请求体转发，是否上行只受本开关控制。

## 6. 零 token 调试开关

三个 MOCK 开关都是为了"不烧 token 验证接线"，默认全关；生产演示前务必确认已关。

### 6.1 `MOCK_MODEL`（默认 `0`）

置 `1` 时 `/api/chat` **在探测模型之前**短路：不调用任何上游、不校验 Key，只把组装好的发送结构
回显成摘要（`lib/mock/chat.ts`）。用于零 token 验证「上传文件 → 组装消息 → 发送」链路。

- 同一开关对 `/api/diagnose-paper` 生效：走固定剧本零 token 跑完「切题 → 分类 → 分组诊断 → 汇总」
  四步，产出内容标注「MOCK 仿真」（`doc/diagnose-paper.md` §7）。
- 测试用例也用它（`test/app/api/chat-mock.test.ts`）。

### 6.2 `MOCK_IMAGE_MODE`（默认留空 = 自动）

仅在 `MOCK_MODEL=1` 时有意义，决定 MOCK 回显里图片的投喂方式：

- 留空 / `multimodal`：按附件自动判定（同真实链路的 `resolveAssembleImageMode`）。
- `text-only`：强制降级为文字占位，用于复现纯文本模型的降级路径
  （`doc/diagnose-file-intake.md` §8）。

### 6.3 `MOCK_OCR`（默认 `0`）

置 `1` 时 `/api/ocr` 不碰 `glm-ocr` 上游、**也不校验 `ZHIPU_API_KEY`**，直接返回占位文本
`[MOCK]云端OCR转写占位（MOCK_OCR=1，未调用上游）`，用于零 token 验证云端 OCR 接线
（`doc/cloud-ocr.md` §5）。注意它的判断在可用性校验之前，因此"没配 Key 也能通"是这个开关的预期行为，
不代表云端 OCR 真的可用。

## 7. 历史遗留参数（已注释停用）

`harness` / `agent` / `rag` / 旧 OCR / 旧 PDF 链路对应的源码已删除，下列变量**全仓无任何读取点**，
`.env.example` 仅以注释保留原文便于恢复。填入值不会有任何效果。

| 变量 | 原含义 | 现在怎么办 |
| --- | --- | --- |
| `OCR_MODE` | `local` / `cloud` 选择识别引擎 | 改由设置项 `ocr.engine` 决定（`doc/cloud-ocr.md` §4） |
| `AGENT_MAX_ASKS` | 单次追问轮数上限 | 追问预算改由诊断状态机控制（`doc/agent-workflow.md`） |
| `AGENT_MAX_TOOL_ROUNDS` | 单轮工具循环上限 | 已由 `TOOL_MAX_ROUNDS` 取代（§4.2） |
| `REQUEST_TIMEOUT_MS` | 模型请求超时（ms） | 代码固定 120s（`REQUEST_TIMEOUT`），不可配 |
| `OCR_TIMEOUT_MS` | 单图 OCR 超时（ms） | 云端 OCR 无该配置，走 fetch 默认超时 |
| `OCR_CACHE_LIMIT` | OCR 结果缓存条数 | 无缓存实现，客户端每次请求即转写 |
| `IMAGE_MAX_MB` | 图片附件体积上限（MB） | 硬编码 12MB（`MAX_DATA_URL`，`lib/chat/messages.ts`） |
| `PDF_MAX_CHARS` | PDF 提取字符上限 | 硬编码 20000 字符 + 80 页（`lib/diagnose/extract.ts`） |
| `EMBED_TIMEOUT_MS` | 向量嵌入超时（ms） | 本地 embedding 走浏览器端，不再受服务端超时约束 |

> 恢复旧链路需要同时还原对应源码（`lib/harness`、`lib/agent`、`lib/rag`、`lib/ocr.ts`、`lib/pdf.ts`），
> 只是取消注释不会让旧链路复活。

## 8. 常见配置组合

### 8.1 最小可用：DeepSeek 官方主线

```dotenv
DEEPSEEK_API_KEY=sk-xxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
```

其余保持默认。`deepseek-flash` 属官方 Vision 款，图片以 `image_url` 直传；切到
`deepseek-v4-pro` 则改走本地 OCR 转文字后纯文本上行——文本款直传会被上游 400，降级路径不报错。

### 8.2 多模态直读：智谱视觉款

```dotenv
ZHIPU_API_KEY=xxxxxxxx
ZHIPU_MODEL=glm-5.3-flash
```

`glm-5.3-flash` / `glm-5.3-flashx` 在目录中标注 `vision: true`，图片直接以 `image_url` 上行，不再转写。
要点：模型能力来自聚焦目录而非 `/models`，改 `ZHIPU_MODEL` 不会新增下拉项。

### 8.3 全本地 / 自建端点：Ollama 或 vLLM

```dotenv
CUSTOM_API_KEY=ollama
CUSTOM_BASE_URL=http://localhost:11434/v1
CUSTOM_MODEL=qwen3:8b
CUSTOM_ALLOW_IMAGES=0
CUSTOM_TOOL_MODE=native
```

- `CUSTOM_API_KEY` 不能留空（可用性要求 Key 与 Base URL 同时非空），本机服务填占位即可。
- 模型未装 `tools` 能力时切 `CUSTOM_TOOL_MODE=text`，否则工具调用会解析失败。
- 端点无视觉能力时保持 `CUSTOM_ALLOW_IMAGES=0`，图片走本地 OCR 转文字。

### 8.4 零 token 联调 / 演示前自检

```dotenv
MOCK_MODEL=1
MOCK_IMAGE_MODE=text-only
MOCK_OCR=1
```

三条链路（对话、诊断、云端 OCR）全部不碰上游。结束联调后**务必改回 `0` 并重启**，
否则界面看着正常、实际没有调用任何模型。

### 8.5 长会话 / 整卷诊断

默认 24000 字符预算对整卷诊断偏紧（长题面 + 多轮追问容易触发裁剪）。需要保留更多历史时上调，例如
`TRIM_BUDGET_CHARS=60000`；想完全关闭裁剪设 `0`，但要自行承担 token 费用与上游上下文上限。
裁剪只影响服务端发送给模型的历史，不影响浏览器本地保存的会话记录（`doc/chat-history.md`）。

## 9. 取值口径陷阱

多个开关是**严格字符串比较**，不是"真值判断"，填错值会静默失效；模型名类变量则要求落在枚举内（见末行）：

| 变量 | 生效条件 | 填这些**不会**生效 |
| --- | --- | --- |
| `TOOLS_ENABLED` | 值 ≠ `false` 即开启 | `False`、`0`、`no`、`off`（仍开启） |
| `CUSTOM_TOOL_MODE` | 严格 `text` 切文本协议 | `TEXT`、`Text` |
| `CUSTOM_ALLOW_IMAGES` | 严格 `1` | `true`、`yes`、`2`（仍关闭） |
| `USER_FIELD_ENABLED` | 值 ≠ `0` 即开启 | `false`、`no`（仍开启） |
| `MOCK_MODEL` / `MOCK_OCR` | 严格 `1` | `true`、`yes` |
| `MOCK_IMAGE_MODE` | 严格 `text-only` | `text`、`text_only` |
| `TRIM_BUDGET_CHARS` | 非负整数（`0` = 禁用） | 负数、`12k`、带单位写法 |
| `DEEPSEEK_MODEL` | 填 `/models` 枚举内的名字（`deepseek-flash` / `deepseek-v4-pro`） | `deepseek-v4-flash`（过渡别名，不在枚举与白名单内，下拉不显示，见 §3.1） |

另外：

- `.env` 里不要给值加引号或行内注释以外的修饰；`MOCK_IMAGE_MODE=` 留空表示"自动"，不是"关闭"。
- 修改后必须重启进程。`next dev` 下改动 `.env*` 会自动重启，`next start` 下不会。

## 10. 未被 `.env.example` 收录但仍被代码读取的变量

| 变量 | 读取位置 | 作用 | 默认 |
| --- | --- | --- | --- |
| `HF_MIRROR` | `scripts/copy-local-models.mjs` | 本地模型权重下载源，需可访问 huggingface.co 时切镜像 | `https://huggingface.co` |
| `NODE_ENV` | 框架内置 | 运行环境判定 | 由启动方式决定 |

`HF_MIRROR` 只在资产准备脚本（`npm run` 脚本链）里读取，不影响运行时行为，因此未进模板。
需要内网/镜像环境时在 shell 里临时设置即可：`HF_MIRROR=https://hf-mirror.com npm run <脚本>`
（资产分发协议见 `doc/browser-local-inference.md` §3）。

## 11. 排障对照

| 现象 | 先查什么 |
| --- | --- |
| `/api/chat` 返回 `no_model` | 三家 Key 是否全空；`.env.local` 是否真的被加载（重启过？） |
| 返回 `invalid_model` | 请求的模型名不属于任何已配置 Provider：`GET /api/models` 看真实可用列表 |
| 返回 `unconfigured` | 该家缺 `*_API_KEY` 或 `CUSTOM_BASE_URL` |
| 状态 `unauthorized` | Key 失效（上游 401），换 Key 后重启 |
| 上游返回 `402` / `insufficient_balance_error` | 上游账户余额不足（Key 本身有效），充值后重试；与本机配置无关 |
| 自定义端点 400 且文案提到 `user` | 设 `USER_FIELD_ENABLED=0`（§5.2） |
| 自定义端点 400 且文案提到图片 | 把 `CUSTOM_ALLOW_IMAGES` 改回 `0`，图片改走本地 OCR（§4.4） |
| 工具一次都没触发 | `TOOLS_ENABLED` 是否被写成 `false`；`TOOL_MAX_ROUNDS` 是否填成非数字（§4.1、§4.2） |
| 图片没直传、只有文字 | 当前模型不在视觉名单：DeepSeek 名字无 `flash`/`vision`（如 `deepseek-v4-pro`）；智谱不在 `ZHIPU_CATALOG` 视觉项；custom 未开 `CUSTOM_ALLOW_IMAGES` |
| 长会话早期内容丢失 | `TRIM_BUDGET_CHARS` 过低（默认 24000 字符），见 §8.5 |

## 12. 维护约定

- 新增/删除环境变量时，三处同步：代码读取点 → 本文件 §2 总表与对应分节 → `.env.example` 一行。
- `.env.example` 只写"变量名 + 示例值 + 分组标题"，不写语义说明；语义一律落本文件，避免两处漂移。
- 变量总数核对口径：`.env.example` 中有效的 `KEY=` 行数 + 注释掉的历史遗留行数，与 §2 表格行数一致。
*（内容由AI生成，仅供参考）*
*（内容由AI生成，仅供参考）*
*（内容由AI生成，仅供参考）*
