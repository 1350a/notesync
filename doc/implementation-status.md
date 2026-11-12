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
> 相关协议：`product-vision.md`、`diagnosis-model.md`、`agent-workflow.md`、`safety-protocol.md`
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
| 本地 OCR（tesseract.js chi_sim） | 已实装，`/ocr` 有自检面板 | ✅ | `lib/ocr.ts` |
| OCR 资产复制脚本 | 已实装，幂等 | ✅ | `scripts/copy-ocr-assets.mjs` |
| 图片模式派生（direct / local-ocr） | 已实装 | ✅ | `lib/ocr/image-handling.ts` |
| 本地嵌入引擎（bge-small-zh-v1.5） | 已实装 | ✅ | `lib/local/engine.ts` |
| 混合检索纯函数 | 已实装 | ✅ | `lib/local/rag/search.ts` |
| 种子知识卡 | 27 条，数学单学科 | 🟡 | `lib/local/rag/seed.ts` |
| RAG 触发条件（查询侧阈值） | 已实装：`shouldRetrieve()`，有效字符数 ≥ 8（去空白）才检索，短问候直接跳过 | ✅ | `lib/local/rag/gate.ts` |
| RAG 触发条件（语料侧阈值） | 未实装：种子卡固定，语料规模阈值随「笔记语料索引化」落地时再定（协议 §5.4） | 🧊 | `doc/browser-local-inference.md` §5.4 |
| 语义缓存 | 无 | 🧊 | — |
| 错因聚类（复用嵌入） | 无 | 🧊 | — |
| `chunkText` 调用方 | 纯函数已有，无调用方 | 🧊 | `lib/local/rag/search.ts` |
| `disposeLocalEngine()` 调用方 | 已实装：租约引用计数，`acquireLocalEngine` / `releaseLocalEngine` 归零时释放；能力页、设置分区与聊天链路共用同一租约 | ✅ | `lib/local/engine-lease.ts` |
| 本地对话（端侧生成） | 占位禁用 | 🧊 | — |

## 4. 安全与合规

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| `content_blocked` 错误码 | 已实装（`/api/chat` 与 `/api/diagnose-paper` 同码同文案） | ✅ | `lib/safety/block-detect.ts`、`lib/safety/messages.ts` |
| 拦截信号归一（两条路径） | 已实装：`finishReason` + 文本双侧判定收敛为同一函数 | ✅ | 同上 |
| 拦截后本轮历史回滚 | 已实装：已流出片段丢弃，被拒内容不入下一轮历史 | ✅ | `hooks/useChat.ts`、`lib/chat/messages.ts` |
| 输入侧本地词表过滤 | 机制已实装（结构规则默认启用）；**默认词表为空**，实际词表走配置注入 | 🟡 | `lib/safety/wordlist.ts` |
| 三级处置话术 | 已实装：硬拦截 / 软引导（system prompt 承载）/ 关怀转介 | ✅ | `lib/safety/messages.ts` |
| 设备标识 `user` 字段 | 已实装：请求体 `user`（纯随机 UUID，localStorage `notesync-user-id`），服务端 ≤64 长度校验后随 Provider 转发；`X-Client-Id` 仅作日志追踪，两者不混用 | ✅ | `lib/client-id.ts`、`app/api/chat/route.ts`、`app/api/diagnose-paper/route.ts` |
| 重置设备标识入口 | 已实装：设置「数据」分区「重置设备标识」按钮，重置后下次请求生效 | ✅ | `components/settings/DataSection.tsx` |
| 图片上传明示 | 已实装：聊天输入区三档逐档标注是否外发，整卷上传区对外发档明示「图片将上传至模型服务商」 | ✅ | `components/chat/ChatInput.tsx`、`app/(main)/diagnose/_components/UploadArea.tsx` |
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
| `systemPrompt` / `temperature` / `maxTokens` | 协议标注未接线 | 🧊 | `doc/user-settings.md` |

## 6. 工程与质量

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 三家 Provider 路由 | 已实装 | ✅ | `lib/provider/index.ts` |
| 模型探测 30s 缓存 | 已实装 | ✅ | 同上 |
| DeepSeek 流式 `usage` 消费 | 未消费 | 🧊 | `lib/provider/openaiCompat.ts` |
| 动态 import / Suspense | 部分 | 🟡 | — |
| 关键测试 + CI | 测试 19 文件 / 208 用例，`npm test` 全过；CI 已接：push / PR 到 `dev`、`main`，lint → tsc → test → build → 8 项 smoke 共 15 step，本地同序预演全绿，CI 配置自 `5f57816` 起已在远端 `dev`，远端运行结论以 Actions 页为准 | ✅ | `test/`、`vitest.config.mts`、`.github/workflows/ci.yml` |
| CSP 基础版 | 已实装，nonce/hash 挂账 | 🟡 | `next.config.ts` |
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
| §7 输出纪律三条禁令写入提示词（`lib/diagnose/prompts.ts`） | `diagnosis-model.md` §7 | ✅ |
| 「必须引用作答片段」后置校验（连续窗口 + bigram 兜底） | 同上 §7.3 | ✅ |
| 全本地 / 多模态 / 混合三档（`lib/ocr/image-handling.ts`） | `product-vision.md` P4 | 🟡 |
| `explain` 掌握度回路（明白了 / 还不懂） | `agent-workflow.md` §4.3(a) | ✅ |
| 成本计量口径（每次诊断调用次数、token 区间） | 交付边界 D | ✅ |
| 演示脚本按「评委 3 分钟看懂诊断≠搜题」编排 | `product-vision.md` §3.3 | ✅（落点 `doc/demo-script.md`：开场 15s → 单题 55s → 整卷 55s → 本地优先与代价 30s → 收尾 15s，含讲者禁忌表与四类事故兜底） |
| 首页视觉重构 | 空白 #6 | ✅（结构层级已定稿：删占位卡，改为对话诊断 / 整卷批量 / 本地优先三卖点卡 +「上传 → 追问 → 报告」流程三栏，各带入口；视觉打磨另议） |
| 上下文裁剪（不设硬边界，长会话只保留当前题相关） | 空白 #5 | ✅ |

> 三档已按模型能力自动派生、可当次切换，但「选另一条路径要多慢 / 多差」的代价提示未做，故记 🟡（依据 `product-vision.md` P4）。

## 10. 待决策

- [x] 英语 v1 是否确认为「不做」，多学科仅作架构预留 —— **已定（2026-11-12）：v1 不做英语，不排期；仅保留 `DiagnosisResult.subject: 'math'` 与 `DiagnoseSubject` 的架构预留，等剩余时间再议，不以任何形式进入本期 MVP**
- [x] RAG 触发阈值（建议按语料字数，如 > 3000 字）—— **已定（2026-11-12）：查询侧阈值 `RAG_MIN_QUERY_CHARS = 8`（去空白后有效字符数），落点 `lib/local/rag/gate.ts`；语料侧 3000 字阈值仅适用于尚未落地的笔记语料索引化，本期不实现**
- [x] 设备标识字段确认为请求体 `user` —— **已定（2026-11-12）：确认用请求体 `user`（OpenAI 兼容规范），不使用 HTTP header；与日志用 `X-Client-Id` 严格区分，代码已实装**
- [x] `confidence` 判定依据（模型自评是否可信）—— **已定（2026-11-12）：采信模型自评，不引入外部校验层；置信度仅用于决定是否强制回显确认（协议 §1.3），不作为对外结论强度声明**
- [x] 演示主线是否包含整卷流程（`product-vision.md` §3.3，纯演示取舍，不涉及代码）—— **已定（2026-11-12）：含，整卷占约 55 秒，见 `doc/demo-script.md` 分镜第 3 段**
*（内容由AI生成，仅供参考）*
