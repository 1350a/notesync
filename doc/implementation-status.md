---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 0389a83fdf2fd477e56fb14bde9a8feb_b901a238ddd011f1997d52540024e231
    ReservedCode1: /heffM5RchtCWyHQUdEKZmegBsxtdjHF0hBqLW7TdvP20fyttn8J+a0FbF7czmlzEtFZosR9pvkQl+UHjhinnLBnyl5ocaRE4KBYeXxrldaUPDQMql5yz4E7tlY7VYFVHnAva3oX8siPn0cFLUb0YAU9xyGUhnMNrjVUalXw9NoCKCfYTlS7F0PYBlk=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 0389a83fdf2fd477e56fb14bde9a8feb_b901a238ddd011f1997d52540024e231
    ReservedCode2: /heffM5RchtCWyHQUdEKZmegBsxtdjHF0hBqLW7TdvP20fyttn8J+a0FbF7czmlzEtFZosR9pvkQl+UHjhinnLBnyl5ocaRE4KBYeXxrldaUPDQMql5yz4E7tlY7VYFVHnAva3oX8siPn0cFLUb0YAU9xyGUhnMNrjVUalXw9NoCKCfYTlS7F0PYBlk=
---

# 实施状态与待办总账

> **状态：持续更新。** 本文件是唯一的总账，所有「已实装 / 未实装 / 挂账」以本文为准。
> 更新规则：每次合并涉及下列任一条目的改动，同步更新本表的状态列。
> **定位：本文已转正为正式协议**（原文 `wip-implementation-status.md`，2026-11-12 去 `wip-` 前缀）。记录事实状态不等于放宽 `AGENTS.md §8`（Wiring Honesty）——界面上仍不得出现未实装能力。
> 相关协议：`product-vision.md`、`diagnosis-model.md`、`agent-workflow.md`、`safety-protocol.md`、`safety-design.md`
> **约束强度**：分级说明见 `product-vision.md` §0。本文记录的是**事实状态**而非约束——表里标 ❌ 的条目，实现方式可以完全不同于对应协议章节，只要该条目的目标达成即可把状态改为 ✅。

图例：✅ 已实装 · 🟡 部分实装 · ❌ 未实装 · ⏳ 待决策 · 🧊 挂账（v1 不做）

## 1. 诊断核心

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 完整度门槛（原题必需） | 已实装：只认「有原题」，作答有无决定 L1/L2 走哪条 | ✅ | `lib/diagnose/completeness.ts` |
| L1 题目画像 | 已实装（无作答时的降级输出路径） | ✅ | `lib/diagnose/prompts.ts` |
| L2 错因归因 | 已实装：主错因 + 置信度，次错因可选 | ✅ | `lib/diagnose/runtime.ts` |
| 数学错因枚举（14 条） | 14 条常量表已实装 | ✅ | `lib/diagnose/error-causes.ts` |
| 错因 → 策略卡 | 已实装：按 code 服务端注入 `strategy`，不交模型自由生成 | ✅ | `lib/diagnose/strategies.ts` |
| 提示阶梯（L1/L2/L3） | 已实装：`hintLevel` 由掌握度回路逐级下降 | ✅ | `lib/diagnose/prompts.ts` |
| `DiagnosisResult` 结构 | 已实装 | ✅ | `lib/diagnose/types.ts` |
| 附件四类标签与组装 | 已实装 | ✅ | `lib/diagnose/assemble.ts` |
| PDF 文字层提取 | 已实装 | ✅ | `lib/pdf.ts` |
| 答案解析语言（中文讲解 / 英文例句） | 英语不实装，暂不涉及 | 🧊 | — |

## 2. 工作流

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 多轮工具循环 | 已实装 | ✅ | `lib/tools/loop.ts` |
| `ask_user` 中断与回填 | 已实装 | ✅ | `lib/tools/builtin/ask_user.ts` |
| SSE 七类事件 | 已实装 | ✅ | `app/api/chat/route.ts` |
| 诊断状态机 | 已实装：纯函数迁移表 + 服务端推导事件 | ✅ | `lib/diagnose/state-machine.ts` |
| 追问预算 + 强制收敛 | 已实装：`CLARIFY_BUDGET` 预扣，耗尽强制收敛 | ✅ | 同上 |
| 拒绝补充的降级出口 | 已实装：`clarify_done{refused}` → `L1_only` | ✅ | 同上 |
| 整卷：切题 → 分类 → 共享诊断 → 汇总 | 已实装，契约见 `doc/diagnose-paper.md` | ✅ | `app/api/diagnose-paper/route.ts` |
| `lookup_strategy` 工具 | 决策已定：策略卡内联进提示词，不工具化 | 🧊 | `lib/diagnose/prompts.ts` |
| native 工具模式 | 已实装，默认 | ✅ | `lib/tools/adapters/native.ts` |
| text 工具模式 | 仅 `custom` 下启用，**实测未通过** | 🧊 | `lib/tools/adapters/text.ts` |
| `ProviderModel.supportsTools` 能力位 | 缺 | 🧊 | `lib/provider/types.ts` |

## 3. 本地能力

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 本地 OCR（tesseract.js chi_sim） | 已实装，`/ocr` 有自检面板 | ✅ | `lib/ocr/local.ts` |
| OCR 资产复制脚本 | 已实装，幂等 | ✅ | `scripts/copy-ocr-assets.mjs` |
| 图片模式派生（direct / ocr-text，按模型能力自动路由） | 已实装 | ✅ | `lib/ocr/image-handling.ts` |
| 本地嵌入引擎（bge-small-zh-v1.5） | 已实装 | ✅ | `lib/local/engine.ts` |
| 混合检索纯函数 | 已实装 | ✅ | `lib/local/rag/search.ts` |
| 种子知识卡 | 30 条（数学单学科 27 张 + 应用指南 3 张） | 🟡 | `lib/local/rag/seed.ts` |
| RAG 触发条件（查询侧阈值） | 已实装：`shouldRetrieve()`，有效字符数 ≥ 8（去空白）才检索，短问候直接跳过 | ✅ | `lib/local/rag/gate.ts` |
| RAG 触发条件（语料侧阈值） | 未实装：种子卡固定，语料规模阈值随「笔记语料索引化」落地时再定（协议 §5.4） | 🧊 | `doc/browser-local-inference.md` §5.4 |
| 语义缓存 | 无 | 🧊 | — |
| 错因聚类（复用嵌入） | 无 | 🧊 | — |
| `chunkText` 调用方 | 纯函数已有，无调用方 | 🧊 | `lib/local/rag/search.ts` |
| `disposeLocalEngine()` 调用方 | 已实装：租约引用计数，`acquireLocalEngine()` 返回幂等释放函数，计数归零时调用 `disposeLocalEngine()`；能力页、设置分区与聊天链路共用同一租约 | ✅ | `lib/local/engine-lease.ts` |
| 本地对话（端侧生成） | 占位禁用 | 🧊 | — |

## 4. 安全与合规

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| `content_blocked` 错误码 | 已实装（`/api/chat` 与 `/api/diagnose-paper` 同码同文案） | ✅ | `lib/safety/block-detect.ts`、`lib/safety/messages.ts` |
| 拦截信号归一（两条路径） | 已实装：`finishReason` + 文本双侧判定收敛为同一函数 | ✅ | 同上 |
| 拦截后本轮历史回滚 | 已实装：已流出片段丢弃，被拒内容不入下一轮历史 | ✅ | `hooks/useChat.ts`、`lib/chat/messages.ts` |
| 输入侧本地词表过滤 | 机制已实装（结构规则默认启用，含超长/乱码/刷屏顺序判定）；**默认词表为空**，实际词表走配置注入 | 🟡 | `lib/safety/wordlist.ts` |
| 服务端输入兜底（`input_blocked`） | 已实装：`/api/chat` 在 MOCK 分支前用同一纯函数复判本轮用户输入，`level==='hard'` 直接返回 `errorStream`，绕不开发包/旧前端/直连接口；心理困扰级别不硬拦（关怀优先） | ✅ | `app/api/chat/route.ts`、`lib/safety/wordlist.ts` |
| 提示注入特征库 | 已实装：结构句式特征判定（`InputSafetyCategory` 增 `injection`），不做关键词黑名单，决策与理由见 `doc/safety-design.md`；2026-11-14 收紧为**显著越狱口径**（宾语只认指令层名词或无限制上下文，13 类学习文本误拦回归用例锁进单测） | ✅ | `lib/safety/injection-patterns.ts` |
| 边界拒答前缀 | 已实装：`REFUSAL_PREFIX`（「【边界说明】」）统一话术前缀，自家拒答文本不被误判为上游拦截；**只给越权类硬拒用**，非数学学科与无关话题的软引导不得带 | ✅ | `lib/safety/messages.ts`、`lib/safety/block-detect.ts` |
| 学科边界三级处置 | 已实装（2026-11-14）：① 越权类（索取系统提示/内部规则、无限制模式、扮演其他角色）→ 硬拒 + 前缀；② 非数学学科 → 软引导「这类题我没有专门优化」，不展开、不带前缀；③ 与学习无关话题 → 软引导（第一次引导、再次简短结束）。`SCOPE_BOUNDARY_LINE` 七态各注入一份，`CHAT_BASE_SYSTEM_PROMPT` 同口径；「照常讲解」限定为数学 | ✅ | `lib/diagnose/prompts.ts`、`lib/safety/messages.ts` |
| 拦截打标与冷却 | 已实装：被拦 user 消息打 `blocked`，上行历史改占位文本、被拦 assistant 消息不回传；连续两次拦截进 60s 冷却（`BLOCK_COOLDOWN_MS`） | ✅ | `hooks/useChat.ts`、`lib/safety/messages.ts` |
| 安全链路回归脚本 | 已实装：`npm run smoke:safety`，拦 3 条放 4 条对照表（放行组含 1 条误伤回归样本） | ✅ | `scripts/safety-smoke.ts` |
| 三级处置话术 | 已实装：硬拦截 / 软引导（system prompt 承载）/ 关怀转介 | ✅ | `lib/safety/messages.ts` |
| 设备标识 `user` 字段 | 已实装：请求体 `user`（纯随机 UUID，localStorage `notesync-user-id`），服务端 ≤64 长度校验后随 Provider 转发；`X-Client-Id` 仅作日志追踪，两者不混用 | ✅ | `lib/client-id.ts`、`app/api/chat/route.ts`、`app/api/diagnose-paper/route.ts` |
| 重置设备标识入口 | 已实装：设置「数据」分区「重置设备标识」按钮，重置后下次请求生效 | ✅ | `components/settings/DataSection.tsx` |
| 图片上传明示 | 已实装：发送处按派生档标注外发（多模态「图片将上传至模型服务商」；云端 OCR「图片像素上传至智谱」）。2026-11-14 起档位全自动派生、不再提供手选 | ✅ | `components/chat/ChatInput.tsx`、`app/(main)/diagnose/_components/UploadArea.tsx` |
| 上传前隐私提醒（全入口） | 已实装（2026-11-14）：聊天输入区常驻短句 + 首次上传一次性详细说明；诊断上传区常驻完整三点说明（上传什么 / 本站是否留存 / 怎么切本地）；设置页 hint 随引擎派生。文案按「模式 × 引擎」分五档，不混淆图片 OCR 与通用文件上传；不每次弹窗打断 | ✅ | `lib/ui/notices.ts`、`components/upload/UploadPrivacyNotice.tsx`、`components/chat/ChatInput.tsx`、`app/(main)/diagnose/_components/UploadArea.tsx`、`components/settings/LocalCapabilitySection.tsx` |
| AI 生成内容提示 | 已实装（2026-11-14）：输入区下方常驻单行「回答由 AI 生成，可能存在错误，请核实后使用。」，弱化色、单行、不占额外纵向空间，纯展示无 state | ✅ | `lib/ui/notices.ts`、`components/chat/AiGeneratedNotice.tsx`、`components/chat/ChatInput.tsx` |
| 提示词契约用例 | 已实装（2026-11-14）：锁死「不得只给答案」（禁回退「不得直接给答案」）、学科边界三级结构、仅越权类带 `REFUSAL_PREFIX`；另锁死各态注入边界条款 | ✅ | `test/lib/diagnose/prompt-contract.test.ts`、`test/ui/privacy-notice.test.ts`、`test/ui/notices.test.ts` |
| OCR 引擎标记与文案分流 | 已实装（2026-11-14）：发送时刻引擎随消息落库（`ChatMsg.ocrEngine`，sanitize 白名单放行）与随附件上行（`DiagnoseAttachment.ocrEngine`，parseAttachments 严格判型）；气泡徽章、导出 Markdown、服务端组装标签按引擎区分「云端/本地」，无字段旧数据中性兜底不写死引擎（原「已本地OCR转文字·原图未离开浏览器」在云端引擎下失真） | ✅ | `components/chat/ChatList.tsx`、`lib/history/export.ts`、`lib/history/sanitize.ts`、`lib/diagnose/assemble.ts` |
| 本地数据清除入口 | 已实装 | ✅ | `components/settings/DataSection.tsx` |
| 术语纠正：不得写「云端 OCR」 | 已完成：`browser-local-ocr.md` 已无该表述 | ✅ | `doc/browser-local-ocr.md` |

## 5. 偏好与设置

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 设置存储抽象 + normalize | 已实装 | ✅ | `lib/settings/storage.ts` |
| 主题三选 + 水合 + 反闪烁 | 已实装 | ✅ | `lib/settings/theme.ts` |
| 默认模型下拉 | 已实装 | ✅ | `components/ModelSelect.tsx` |
| 取消首次引导，改默认档 | 已实装：不弹首次引导，冷启即保守档（图片默认先本地转文字，原图不出端；只有显式 `false` 才切外发） | ✅ | `lib/settings/types.ts`、`test/lib/settings/defaults.test.ts` |
| 效率/质量档位字段 | 已实装：`thinkingEffort` 四档（off/low/medium/high），设置面板可选 | ✅ | `lib/settings/types.ts` |
| 档位映射 `thinking` / `reasoning_effort` | 已实装：`mapThinkingParam` 按 Provider 映射，`off` 不发参数 | ✅ | `lib/provider/openaiCompat.ts` |
| 思考预算 `maxTokens` | 已实装：`normalizeMaxTokens` 归一（≤0/NaN/非数值视为未设置，超上限钳制），`mapMaxTokens` 按 Provider 分流下发 `max_tokens`（**custom 恒不发**，未知字段严格校验风险），经工具循环与收敛请求一并透传；设置页「思考预算」下拉提供跟随模型默认 / 1024 / 4096 / 8192 | ✅ | `lib/settings/types.ts`、`lib/provider/openaiCompat.ts`、`lib/tools/loop.ts` |
| `systemPrompt` / `temperature` | 未接线（协议标注未接，服务端注入待做） | 🧊 | `doc/user-settings.md` |

## 6. 工程与质量

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 三家 Provider 路由 | 已实装 | ✅ | `lib/provider/index.ts` |
| 模型探测 30s 缓存 | 已实装 | ✅ | 同上 |
| DeepSeek 流式 `usage` 消费 | 已实装：`stream_options.include_usage=true`，`usage` 解析进 `Trace.usage` 并在调试面板可导出 | ✅ | `lib/provider/openaiCompat.ts`、`lib/chat/trace.ts` |
| trace 观测面留档 | 已实装：本地事件流按条分片存储（索引键 `notesync-trace-v2-index` + 分片键 `notesync-trace-v2-<id>`），索引只存 `startedAt`/`route`/`model`/`size` 等元数据；单条超 200k 字符截断 `events` 尾部并打 `truncated` 标记；按条数（`TRACE_KEEP=20`）加单条上限淘汰；首次写入做 v1 单键 → v2 一次性迁移，坏片跳过不整库丢弃 | ✅ | `lib/chat/trace.ts`、`test/lib/chat/trace-store.test.ts` |
| trace 导出脱敏 | 已实装：`reasoning` 写入不截断（保留完整分析能力），仅导出出口经 `redactTraceText()` 处理副本——**只抹实现细节**（内部字段名 `completeness`/`hintLevel`/`submit_diagnosis` 等、提示词常量名 `DISCIPLINE_BLOCK` 等、协议标记 `protocol`，统一替换为 `[内部字段]`）；**提示条款原文与产品话术（`【边界说明】`）不隐藏**（开源项目不追求隐藏提示词，安全目标是不输出有害内容 + 数据流向可见）；公式、行内代码、围栏代码块与 URL 走白名单原样保留，`x²`/`f(x)`/`△ABC` 不被改写；`downloadTraces()` 经 `buildTraceExportPayload()` 导出脱敏副本，浏览器内存储保持原文 | ✅ | `lib/safety/redact.ts`、`lib/chat/trace.ts`、`test/lib/safety/redact-trace.test.ts`、`test/lib/chat/trace-export.test.ts` |
| 思考面板三级展示 | 已实装：默认折叠；展开后先显示前 400 字 + 省略号与「共 N 字」；超过 400 字再给「展开完整推理」按钮显示全文，折叠时重置全文态 | ✅ | `components/chat/ChatList.tsx` |
| 动态 import / Suspense | 部分 | 🟡 | — |
| 关键测试 + CI | 测试 45 文件 / 493 用例（2026-11-14 实测，merge `73b291a` 后；此前依次为 42 文件 / 468 用例、42 文件 / 457 用例、40 文件 / 431 用例、36 文件 / 400 用例、30 文件 / 352 用例、更早 26 文件 / 310 用例），`npm test` 全过；CI 已接：push / PR 到 `dev`、`main`，lint → tsc → test → build → 8 项 smoke 共 15 step，本地同序预演全绿，CI 配置自 `5f57816` 起已在远端 `dev`，远端运行结论以 Actions 页为准 | ✅ | `test/`、`vitest.config.mts`、`.github/workflows/ci.yml` |
| CSP 基础版 | 已实装，nonce/hash 挂账 | 🟡 | `next.config.ts` |
| 路由级兜底（error / global-error / not-found / loading） | 已实装（2026-11-14）：根级 `app/error.tsx` 兜住根布局之下全部路由段的渲染异常（Next 16 `retry` 口径，`error: unknown` 收窄后仅上屏 digest，细节只进控制台）；`app/global-error.tsx` 自带 `<html>/<body>`、`globals.css` 与同款防闪烁脚本，兜根布局自身；`app/not-found.tsx` 兜 `notFound()` 与全应用未匹配 URL；`(main)/loading.tsx` 内容区骨架（侧栏顶栏由布局承载不变）。结构用例 `test/ui/error-fallback.test.ts` 锁定 | ✅ | `app/error.tsx`、`app/global-error.tsx`、`app/not-found.tsx`、`app/(main)/loading.tsx` |
| 移动端适配 | §2~§7 全部实装，含发送吸底例外（`handleSend` 无条件吸底一次，commit `cb2ecee`） | ✅ | `doc/mobile-ux.md` |

## 7. MVP 范围（交差口径）

**必做**（缺一不可）：

1. 完整度门槛 + L1/L2 两段式
2. 数学错因枚举 + 策略卡
3. 提示阶梯 + 追问预算
4. 诊断状态机（简版）
5. 整卷：切题 → 逐题 L2 → 汇总（聚类可后置）
6. `content_blocked` + 三级话术 + 输入侧过滤
7. 图片模式提示（含上传明示）
8. 本组文档定稿

**只写文档、不实现**：语义缓存、错因聚类、RAG 触发阈值、`supportsTools`、text 模式、本地对话、英语学科。

## 8. 交付顺序

| 序 | 动作 | 产出 |
|---|---|---|
| 1 | 错因表与策略卡评审 | `diagnosis-model.md` 定稿 |
| 2 | 实现诊断核心 | `lib/diagnose/*` |
| 3 | 状态机评审 | `agent-workflow.md` 定稿 |
| 4 | 实现状态机 | `lib/diagnose/state-machine.ts` |
| 5 | 安全协议评审 | `safety-protocol.md` 定稿 |
| 6 | 实现安全项 | `app/api/chat/route.ts` 等 |
| 7 | 整卷流程 | `/diagnose` 工作流 |
| 8 | 收尾 | 去 `wip-` 前缀、更新 README（2026-11-12 已完成：5 份协议全部转正，引用点同步） |

## 9. 文档同步清单

以下既有文档需随本组协议同步修订：

| 文件 | 需改内容 |
|---|---|
| `doc/diagnose-file-intake.md` | 已补交叉引用：完整度判定口径以 `diagnosis-model.md` §1 为准（该文只定义上传标签，不重复定义完整度） |
| `doc/user-settings.md` | 已完成（2026-11-12）：数据管理分区补「重置设备标识」入口，挂账清单标注 `RAG_MIN_QUERY_CHARS` 已接线 |
| `doc/browser-local-inference.md` | 已完成（2026-11-12）：新增 §5.4 触发条件（查询侧阈值），§6.1 改为 `shouldRetrieve(text)`；语料侧阈值与语义缓存、聚类仍挂账 |
| `doc/diagnose-paper.md` | 已完成（2026-11-12）：补齐 `user` 字段来源、长度 > 64 丢弃语义、与 `x-client-id` 不得混用 |
| `doc/browser-local-ocr.md` | 已完成：删除「云端 OCR」表述，改为「本地识别 / 多模态识别」 |

### 9.1 本轮定稿后新增的待办（2026-11-11）

| 条目 | 依据 | 状态 |
|---|---|---|
| 证据可信度分级 + 识别结果回显确认（`components/chat/ChatInput.tsx`） | `diagnosis-model.md` §1.3 | ✅ |
| OCR 低置信强制确认（阈值已定，低置信行标红并阻断直接发送） | 同上 | ✅ |
| §7 输出纪律禁令写入提示词（原三条，第 1、2 条已并为「不得只给答案」；`lib/diagnose/prompts.ts`） | `diagnosis-model.md` §7 | ✅ |
| 「必须引用作答片段」后置校验（连续窗口 + bigram 兜底） | 同上 §7.3 | ✅ |
| 图片路径自动路由：多模态直传 / 纯文本 OCR 转写（2026-11-14 重构，混合档下线；`lib/ocr/image-handling.ts`、`components/chat/ChatInput.tsx`、整卷 `UploadArea.tsx`） | `product-vision.md` P4 | ✅ |
| `explain` 掌握度回路（明白了 / 还不懂） | `agent-workflow.md` §4.3(a) | ✅ |
| 成本计量口径（每次诊断调用次数、token 区间） | 交付边界 D | ✅ |
| 演示脚本按「评委 3 分钟看懂诊断≠搜题」编排 | `product-vision.md` §3.3 | ✅（落点 `doc/demo-script.md`：开场 15s → 单题 55s → 整卷 55s → 本地优先与代价 30s → 收尾 15s，含讲者禁忌表与四类事故兜底） |
| 首页视觉重构 | 空白 #6 | ✅（结构层级已定稿：删占位卡，改为对话诊断 / 整卷批量 / 本地优先三卖点卡 +「上传 → 追问 → 报告」流程三栏，各带入口；视觉打磨另议） |
| 上下文裁剪（不设硬边界，长会话只保留当前题相关） | 空白 #5 | ✅ |

> 2026-11-14 重构：档位不再提供手选，`resolveImageSendMode` 按模型能力自动派生
> （多模态 → 直传原图；纯文本/未知 → OCR 转写，引擎默认云端）、代价提示写在发送处。
> 聊天页与整卷上传区同口径；服务端 `resolveAssembleImageMode` 的混合档判定仅为旧数据
> 兼容保留，UI 不再产出。

### 9.2 代码审查整改（2026-11-12，分支 `fix/review-hardening`）

> 对 143 个源文件（约 1.8 万行，不含 `components/ui`）的审查结论做 9 项整改，全部实装并逐项实测。
> 分支累计 25 个 commit，未推送；门禁全绿：lint 0 告警、`tsc --noEmit` 通过、`npm test` 30 文件 / 352 用例全过、`build` 9 条路由通过、`npm run scan:xss` high 0 / medium 0 / low 1（既有的常量菜单 href 告警）。

| 项 | 问题 | 整改落点 | 实测结论 |
|---|---|---|---|
| S1 | 请求体裸解析，非法 JSON 抛 500 空响应 | `lib/sse.ts` 收拢 `safeJson` / `errorStream` / `readClientId` / `invalid_request`，两路由统一 | 非法 JSON 改为 200 + `text/event-stream` + `{"code":"invalid_request",...}` |
| S2 | 上游错误原文直透客户端 | `lib/provider/openaiCompat.ts` 模板化文案 + `lib/safety/redact.ts`（`extractUpstreamMessage` 只取 message、`redactUpstreamText` 脱敏摘要 ≤ 200 字符），完整原文只进 `console.error` | 402 → 「上游账户余额或额度不足…（上游摘要：Insufficient Balance (request_id: [id])）」，日志仍留完整 JSON |
| S3 | 附件数量无上限 | `lib/diagnose/parse-attachments.ts` 解析前截断 `MAX_ATTACHMENTS = 12` | 200 条入参只取前 12 条并打日志 |
| S4 | system 角色消息直透模型上下文（提示词注入面） | `lib/chat/messages.ts` 的 `buildProviderMessages` 丢弃 role=system 并 `console.warn`；前端 `hooks/useChat.ts` 只对 `content_blocked` 走专属分支，其余 error 统一拼 `[错误] ...` | 非 content_blocked 的新错误码不破坏前端解析 |
| L1 | 历史回读用 `as` 断言，脏数据可直接进渲染层 | `lib/history/sanitize.ts` 逐字段校验 `awaitingQuestions` / `errorCause` / `strategyCard` / `hints` / `diagnosis` | 新增 `test/lib/history/sanitize.test.ts` 用例覆盖 |
| L2 | 反代可能缓冲 SSE | `lib/sse.ts` 的 `SSE_HEADERS` 补 `X-Accel-Buffering: no` | — |
| R1 | 路由过长 | 抽 `lib/mock/chat.ts`、`lib/mock/paper.ts`；`app/api/chat/route.ts` 709 → 402 行，`app/api/diagnose-paper/route.ts` 329 → 280 行 | 纯搬运，零行为变化 |
| R2 | `.env.example` 与实际读取不同步 | 补 `TRIM_BUDGET_CHARS`、`USER_FIELD_ENABLED` | — |
| R3 | 双份 SSE 实现 | 共用 `lib/sse.ts` 的 `sse()` / `SSE_HEADERS` / `x-client-id` | 纯搬运，零行为变化 |

**行为变化（有意为之，非零影响）**：S1 把 HTML 500 改为结构化 SSE error；S3 让超出 12 张的附件被直接丢弃（单题口径仍是 4 张，12 张为整卷余量）；S4 让客户端传入的 system 消息不再进上下文。协议侧已同步 `doc/tool-protocol.md`（`invalid_request` 事件形态）与 `doc/diagnose-file-intake.md`（错误码表）。

## 10. 待决策

- [x] 英语 v1 是否确认为「不做」，多学科仅作架构预留 —— **已定（2026-11-12）：v1 不做英语，不排期；仅保留 `DiagnosisResult.subject: 'math'` 与 `DiagnoseSubject` 的架构预留，等剩余时间再议，不以任何形式进入本期 MVP**
- [x] RAG 触发阈值（建议按语料字数，如 > 3000 字）—— **已定（2026-11-12）：查询侧阈值 `RAG_MIN_QUERY_CHARS = 8`（去空白后有效字符数），落点 `lib/local/rag/gate.ts`；语料侧 3000 字阈值仅适用于尚未落地的笔记语料索引化，本期不实现**
- [x] 设备标识字段确认为请求体 `user` —— **已定（2026-11-12）：确认用请求体 `user`（OpenAI 兼容规范），不使用 HTTP header；与日志用 `X-Client-Id` 严格区分，代码已实装**
- [x] `confidence` 判定依据（模型自评是否可信）—— **已定（2026-11-12）：采信模型自评，不引入外部校验层；置信度仅用于决定是否强制回显确认（协议 §1.3），不作为对外结论强度声明**
- [x] 演示主线是否包含整卷流程（`product-vision.md` §3.3，纯演示取舍，不涉及代码）—— **已定（2026-11-12）：含，整卷占约 55 秒，见 `doc/demo-script.md` 分镜第 3 段**
- [x] 默认思考档 medium / high —— **已定（2026-11-12）：默认 `medium`，不采用 `high`；四档 `off/low/medium/high` 在聊天输入区常驻可切，用户改档后写入 `generation.thinkingEffort` 并持久化，以其选择为准、不再回落默认（实现真源见 `doc/user-settings.md` §2.1）**
*（内容由AI生成，仅供参考）*
