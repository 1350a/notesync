# TTS 朗读协议（tts）

> 状态：v1 实装（双云端引擎 + 消息气泡朗读按钮；2026-11-15 拍板）｜创建：2026-11-15
> 对应代码：`lib/tts/`（catalog / 清洗 / 分段 / 引擎客户端）、`app/api/tts/route.ts`（代理路由）、
> `store/useTtsStore.ts`（播放状态）、`hooks/useTts.ts`（队列播放）、
> `components/chat/MessageActions.tsx`（朗读按钮）、`components/settings/GeneralSection.tsx`（引擎/音色）

## 1. 定位与范围

**TTS 是 AI 回复的可听形态**：用户在消息气泡上点朗读按钮，把该条 assistant 回复合成语音并
按序播放。教育场景下 long-form 讲解（错因分析、策略卡）适合"听"的消化方式；本协议只覆盖
**回复完成后整段合成**（2026-11-15 拍板），边流式生成边朗读挂账 §8。

范围边界：

- 只朗读 **assistant 消息正文**（markdown 源经 §3 清洗）；用户消息、诊断卡片、工具轨迹不在 v1 范围。
- 音频只在浏览器内存中短暂存在（Blob URL），**不落盘、不进会话历史**——刷新即失，重听重新合成（重新计费，由按钮点击显式触发）。
- 密钥不出服务端（`AGENTS.md` §7）：`ZHIPU_API_KEY` / `DEEPSEEK_API_KEY` 复用 chat 链路同款，TTS 无新增 key 变量。

2026-11-15 拍板记录：双云端引擎（GLM-TTS + DeepSeek TTS）都要；入口 = 消息气泡朗读按钮；
合成时机 = 完成后整段合成；浏览器本地 `speechSynthesis` 路线**不做**（挂账 §8）。

## 2. 引擎与端点（2026-11-15 查证）

| 维度 | zhipu（GLM-TTS，**默认引擎**） | deepseek（DeepSeek TTS） |
|---|---|---|
| 端点 | `POST {ZHIPU_BASE_URL}/audio/speech`（默认 `https://open.bigmodel.cn/api/paas/v4`） | `POST {DEEPSEEK_BASE_URL}/v1/tools/tts`（默认 `https://api.deepseek.com`） |
| 请求体 | `{ model: "glm-tts", input, voice, response_format: "wav" }` | `{ text, voice_id, format: "wav" }`（`filter_markdown` 不传——清洗由 §3 统一做） |
| 音色 | `tongtong`（彤彤，默认）/ `chuichui`（锤锤）/ `xiaochen`（小陈）/ `jam` / `kazi` / `douji` / `luodo` | `stella`（海星，女声，默认）/ `tide`（暗潮，男声） |
| 单段文本上限 | 1024 字符 → 本协议切段上限 **1000**（留余量防计费口径差异） | 10000 计费字符（汉字×2）且 64KiB body → 本协议切段上限 **4000** 原始字符（汉字时 = 8000 计费字符，双口径都 ≤ 上限） |
| 语速/音量 | `speed` [0.5, 2] / `volume` (0, 10]（v1 不下发，挂账 §8） | 均不支持（官方明确） |
| 响应 | 二进制 `audio/wav`（**必须显式传 `response_format: "wav"`，默认 pcm 前端 `<audio>` 不能直接播**） | 二进制 `audio/wav` |
| 价格 | ¥2/万字符 | ¥3/万字符（官方标注限时 5 折 ¥1.5，有效与否以官方页为准） |
| 并发 | — | 每账号 50 并发，超出 429 |

引擎注册为纯静态目录 `lib/tts/catalog.ts`（无 env 读取、无网络，供 settings normalize 与 UI
复用）；网络实现分别在 `lib/tts/zhipu.ts` / `lib/tts/deepseek.ts`；聚合路由
`resolveTtsEngine(engineId)` 按 id 查表，未知 id 返回 null（不静默回落，与 provider 路由同口径）。

引擎可用性 = 对应 key 环境变量非空（`ttsEngineAvailable(id)`）：`GET /api/tts` 返回布尔表供设置页
禁用未配置引擎的选项；POST 侧不做预检兜底（key 在请求瞬间仍可能缺失，报 503）。

## 3. 朗读文本清洗（`lib/tts/clean.ts`）

**为什么服务端统一清洗**：markdown 源码直接送合成，标记符号（`#` `**` 反引号）会被读出声、
代码块与 URL 读出来是灾难、渲染端 `<audio>` 无 markdown 概念。DeepSeek 虽有 `filter_markdown`
参数，GLM 没有——两家口径必须一致，因此清洗在本仓库做（DeepSeek 侧不再叠加 `filter_markdown`，
避免双重规则口径漂移）。

清洗为纯函数 `cleanSpeechText(md: string): string`，规则表（顺序即实现顺序）：

| 输入形态 | 处理 | 理由 |
|---|---|---|
| 围栏代码块 ``` ``` ``` | **整块删除** | 朗读代码无意义且极费字符；讲解文字通常在块外 |
| 块级公式 `$$…$$` | **删除** | LaTeX 读出来是乱码；块级公式通常伴随讲解文字 |
| 行内公式 `$…$` | 去定界符保留原文 | 简单式子（`x=1`）可听；删除丢语义 |
| 图片 `![alt](url)` | 删除 | 读不出图 |
| 链接 `[text](url)` | 保留 text | URL 一长串字符不可听 |
| 裸 URL（http/https） | 删除 | 同上 |
| 行内代码 `` `x` `` | 去反引号保留内容 | 内容通常短且有语义（变量名、数字） |
| HTML 标签 | 剥标签保留文字 | markdown 源可能含内联 HTML |
| 标题/加粗/斜体/引用/列表标记（`#` `**` `*` `_` `>` `-` `*` `+`） | 去标记保留文字 | 朗读要的是纯文本流 |
| 表格 | 去分隔行，每行单元格以「，」连接成一行 | 表格不可听，但整表删除丢内容；逐行平铺可听 |
| 水平线 `---`（独立行） | 删除 | 无语义 |
| 连续空白/空行 | 压缩为单个空格或换行 | 减少计费字符 |

清洗后**全空白** → 视为无内容（`empty_text`）：整条消息只有代码块/公式/图链时没有可听的东西，
诚实报错而非合成空白音频烧钱。

## 4. 分段策略（`lib/tts/segments.ts`）

单段上限见 §2（zhipu 1000 / deepseek 4000 原始字符）。纯函数
`splitSpeechSegments(text, maxChars): string[]`：

1. **句切**：按句末标点（`。！？!?；;` 与换行）切分，标点归属前句；
2. **贪心聚合**：连续句子聚合到 ≤ maxChars 为止——段数越少、段间停顿越少、请求越少；
3. **二次切**：单句仍超 maxChars 时按逗号/顿号切，仍超按 maxChars 硬切（防单行无标点超限）；
4. 空段丢弃。

防呆上限（413 `text_too_long`）：清洗后总长 **> 20000 字符** 或 **段数 > 20** 拒绝合成。
理由：朗读是显式点击行为，正常回复几百到两千字；20000 字符≈一整份卷面解析，多半是误触
（例如把整卷报告当消息朗读），先拦下让用户用更合适的入口（挂账 §8 整卷朗读）。

多段串行合成（不上并发）：段序稳定、天然限流；任一段失败**整批失败**（502，不返回部分
音频）——部分成功的音频播放到一半静默中断比"明确失败"更糟，且已合成段的钱上游照扣，
报错让用户知情。

## 5. 设置契约（`tts.engine` / `tts.voice`，doc/user-settings.md §2）

```ts
tts: {
  engine: 'zhipu' | 'deepseek';  // 默认 'zhipu'（音色多、可调速、单价低）
  voice: string;                 // 音色 id，默认随引擎（zhipu: 'tongtong'；deepseek: 'stella'）
}
```

normalize 规则（并入 `normalizeSettings`）：

| 字段 | 非法输入处理 |
|---|---|
| tts.engine | 非 `'zhipu'/'deepseek'` → 回落 `'zhipu'` |
| tts.voice | 不属于所选引擎音色目录 → 回落该引擎默认音色（引擎切换时旧音色自动随迁回落） |

UI（通用设置分区，`GeneralSection`）：**朗读引擎**下拉（未配置密钥的引擎禁用并标注，
数据来自 `GET /api/tts`）+ **朗读音色**下拉（随引擎联动，目录来自 catalog）。替换原
「朗读音色」禁用占位行（诚实接线，`AGENTS.md` §8；user-settings.md §5 表同步）。

## 6. 服务契约（POST /api/tts）

薄壳代理（`app/api/tts/route.ts`，AGENTS.md §2：校验 + 委托 `lib/tts/`）。**key 不出服务端**，
Bearer 头在 lib 层拼装；文本不落盘、不打正文日志（与 chat 同口径）。

**GET /api/tts** → `{ engines: { zhipu: boolean, deepseek: boolean } }`（key 布尔表，设置页用）。

**POST /api/tts** 请求体：

```ts
{ text: string; engine: 'zhipu' | 'deepseek'; voice: string }
```

- `text`：markdown 源（assistant 正文），非空字符串，原始长度上限 100_000（清洗后另有 §4 防呆上限）；
- `engine` / `voice` 必填且经白名单校验（服务端无设置真源，客户端从 settings 显式携带）。

**响应 200**：

```ts
{ segments: { mime: 'audio/wav'; base64: string }[] }
```

前端逐段解码为 Blob 播放（wav 统一格式，`<audio>` 原生支持，零解码依赖）。

**错误码表**（`{ error: code, message }`，message 中文可直显）：

| code | HTTP | 触发 |
|---|---|---|
| `invalid_request` | 400 | JSON 不合法 / 字段缺失或类型错 / `text` 超 100_000 原始字符 |
| `engine_unknown` | 400 | engine 不在白名单 |
| `voice_invalid` | 400 | voice 不属于所选引擎目录 |
| `empty_text` | 400 | 清洗后无内容（§3） |
| `text_too_long` | 413 | 清洗后 > 20000 字符或 > 20 段（§4） |
| `unconfigured` | 503 | 所选引擎 key 未配置 |
| `provider_error` | 502 | 上游错误（HTTP 状态 + 脱敏摘要，`lib/safety/redact.ts` 同口径） |
| `rate_limited` | 429 | 上游并发/频率限制（deepseek 50 并发） |

**MOCK_TTS=1**：不碰上游、不校验 key；**清洗 + 分段真跑**（零成本纯本地），每段返回
固定短静音 wav（代码生成 24000Hz/16bit/mono ≈0.05s）。即 mock 验证的是"清洗 → 分段 →
响应结构 → 前端队列播放"全链，仅音频内容为占位——与 MOCK_OCR 返回占位文本、MOCK_MODEL
回显请求的同思路（零 token 验证接线）。

## 7. 客户端接线与失败语义

**状态**（`store/useTtsStore.ts`，跨组件 UI 状态）：全局单例
`{ messageId, phase: 'idle'|'loading'|'playing'|'error', segmentIndex, segmentCount, errorMessage }`。
**同一时刻至多一条消息在朗读**：点击 A 朗读时若 B 在播，直接打断 B（听是即时意图，不排队）；
点击正在朗读的消息 = 停止。

**播放**（`hooks/useTts.ts`）：

1. `speak(messageId, text)`：store 置 loading → `POST /api/tts`（带 `X-Client-Id`，惯例同 chat）→
   逐段转 Blob URL，`new Audio(url)` 串行播放（`onended` 链到下一段）→ phase playing（segmentIndex 推进）→ 播完回 idle；
2. `stop()`：暂停并释放当前 audio、revoke 全部 Blob URL、abort 进行中的 fetch（AbortController）、store 回 idle；
3. 失败：phase error + errorMessage（上游 message 直显），按钮 title 展示；下一次点击重试。

**按钮**（`MessageActions` 内新增 `SpeakAction`，仅 assistant 且有正文渲染）：状态图标
idle 喇叭 → loading 脉动 → playing 停止方块 → error 感叹号（title 带错误信息）；尺寸/触屏
口径复用既有 `ICON_BUTTON_CLASS`。合成中不阻塞其他操作（可随时再点 = 中断）。

**移动端**：iOS Safari 对异步 `audio.play()` 有手势要求（首次用户交互后的 play 通常放行，
但真机行为需实测）；v1 桌面优先，真机验收与移动端兜底挂账 §8。

## 8. 挂账（不属于本协议 v1）

- **语速调节**：GLM 支持 `speed` [0.5, 2]，DeepSeek 不支持——进 UI 需按引擎禁用，v1 不下发不展示；
- **边生成边读**：流式回复中途开口（DeepSeek WS / GLM SSE 流式），需处理未定句切分与中断续读，工程量约翻倍；
- **浏览器本地 `speechSynthesis`**：零成本兜底档（系统音色、不可落盘、iOS 手势约束），待云引擎跑稳后评估是否作为免费档；
- **音色复刻**：GLM-TTS-Clone（3 秒样本）按次计费，涉及声纹授权合规，暂不接；
- **整卷报告朗读**：`notesync:paper-report:v1` 暂存报告的连续朗读入口（§4 防呆上限之外的长文本合法入口）；
- **移动端真机验收**：iOS 异步 play 手势策略、后台播放与锁屏行为；
- **朗读历史缓存**：同一条消息重复朗读重新计费，可按消息 id 暂存 Blob（内存生命周期 = 会话），
  评估存储收益后决定。
