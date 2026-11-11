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

# 实施状态与待办总账（WIP）

> **状态：持续更新。** 本文件是唯一的总账，所有「已实装 / 未实装 / 挂账」以本文为准。
> 更新规则：每次合并涉及下列任一条目的改动，同步更新本表的状态列。
> **定位：本组 `wip-*.md` 为中间产物，不对外公开，交付前删除。** 但删除文档不等于放宽 `AGENTS.md §8`（Wiring Honesty）——界面上仍不得出现未实装能力。
> 相关协议：`wip-product-vision.md`、`wip-diagnosis-model.md`、`wip-agent-workflow.md`、`wip-safety-protocol.md`
> **约束强度**：分级说明见 `wip-product-vision.md` §0。本文记录的是**事实状态**而非约束——表里标 ❌ 的条目，实现方式可以完全不同于对应协议章节，只要该条目的目标达成即可把状态改为 ✅。

图例：✅ 已实装 · 🟡 部分实装 · ❌ 未实装 · ⏳ 待决策 · 🧊 挂账（v1 不做）

## 1. 诊断核心

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 完整度门槛（原题必需） | 现按四要素判 | ❌ | `wip-diagnosis-model.md` §1 |
| L1 题目画像 | 无 | ❌ | 同上 §2 |
| L2 错因归因 | 无 | ❌ | 同上 §2 |
| 数学错因枚举（14 条） | 无 | ❌ | 同上 §3 |
| 错因 → 策略卡 | 无 | ❌ | 同上 §4 |
| 提示阶梯（L1/L2/L3） | 无 | ❌ | 同上 §5 |
| `DiagnosisResult` 结构 | 无 | ❌ | 同上 §6 |
| 附件四类标签与组装 | 已实装 | ✅ | `lib/diagnose/assemble.ts` |
| PDF 文字层提取 | 已实装 | ✅ | `lib/pdf.ts` |
| 答案解析语言（中文讲解 / 英文例句） | 英语不实装，暂不涉及 | 🧊 | — |

## 2. 工作流

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 多轮工具循环 | 已实装 | ✅ | `lib/tools/loop.ts` |
| `ask_user` 中断与回填 | 已实装 | ✅ | `lib/tools/builtin/ask_user.ts` |
| SSE 七类事件 | 已实装 | ✅ | `app/api/chat/route.ts` |
| 诊断状态机 | 现为单轮循环，无显式状态 | ❌ | `wip-agent-workflow.md` §2 |
| 追问预算 + 强制收敛 | 无 | ❌ | 同上 §4 |
| 拒绝补充的降级出口 | 无 | ❌ | 同上 §4.2 |
| 整卷：切题 → 分类 → 共享诊断 → 汇总 | `/diagnose` 工作流空缺 | ❌ | 同上 §5 |
| `lookup_strategy` 工具 | 无 | ❌ | 同上 §3 |
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
| RAG 触发条件（长语料才启用） | 现为全场景开关 | ❌ | `doc/browser-local-inference.md` |
| 语义缓存 | 无 | 🧊 | — |
| 错因聚类（复用嵌入） | 无 | 🧊 | — |
| `chunkText` 调用方 | 纯函数已有，无调用方 | 🧊 | `lib/local/rag/search.ts` |
| `disposeLocalEngine()` 调用方 | 无，引擎常驻内存 | ❌ | `lib/local/engine.ts` |
| 本地对话（端侧生成） | 占位禁用 | 🧊 | — |

## 4. 安全与合规

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| `content_blocked` 错误码 | 无 | ❌ | `wip-safety-protocol.md` §2 |
| 拦截信号归一（两条路径） | 无 | ❌ | 同上 §3 |
| 拦截后本轮历史回滚 | 无 | ❌ | 同上 §3.1 |
| 输入侧本地词表过滤 | 无 | ❌ | 同上 §4 |
| 三级处置话术 | 无 | ❌ | 同上 §5 |
| 设备标识 `user` 字段 | 仅有日志用 `X-Client-Id` | 🟡 | 同上 §6 |
| 重置设备标识入口 | 无 | ❌ | 同上 §6.2 |
| 图片上传明示 | 无 | ❌ | 同上 §7 |
| 本地数据清除入口 | 已实装 | ✅ | `components/settings/DataSection.tsx` |
| 术语纠正：不得写「云端 OCR」 | 现有文档存在该表述 | ❌ | `doc/browser-local-ocr.md` |

## 5. 偏好与设置

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 设置存储抽象 + normalize | 已实装 | ✅ | `lib/settings/storage.ts` |
| 主题三选 + 水合 + 反闪烁 | 已实装 | ✅ | `lib/settings/theme.ts` |
| 默认模型下拉 | 已实装 | ✅ | `components/ModelSelect.tsx` |
| 取消首次引导，改默认档 | 决策已定，未实装 | ❌ | `wip-product-vision.md` §3.1 |
| 效率/质量档位字段 | 无 | ❌ | `doc/user-settings.md` |
| 档位映射 `thinking` / `reasoning_effort` | 请求体未带该两参数 | ❌ | `lib/provider/deepseek.ts` |
| `systemPrompt` / `temperature` / `maxTokens` | 协议标注未接线 | 🧊 | `doc/user-settings.md` |

## 6. 工程与质量

| 条目 | 现状 | 状态 | 落点 |
|---|---|---|---|
| 三家 Provider 路由 | 已实装 | ✅ | `lib/provider/index.ts` |
| 模型探测 30s 缓存 | 已实装 | ✅ | 同上 |
| DeepSeek 流式 `usage` 消费 | 未消费 | 🧊 | `lib/provider/openaiCompat.ts` |
| 动态 import / Suspense | 部分 | 🟡 | — |
| 关键测试 + CI | 缺失 | ❌ | — |
| CSP 基础版 | 已实装，nonce/hash 挂账 | 🟡 | `next.config.ts` |
| 移动端适配 | §2~§7 基本实装，发送吸底例外挂账 | 🟡 | `doc/mobile-ux.md` |

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
| 1 | 错因表与策略卡评审 | `wip-diagnosis-model.md` 定稿 |
| 2 | 实现诊断核心 | `lib/diagnose/*` |
| 3 | 状态机评审 | `wip-agent-workflow.md` 定稿 |
| 4 | 实现状态机 | `lib/diagnose/state-machine.ts` |
| 5 | 安全协议评审 | `wip-safety-protocol.md` 定稿 |
| 6 | 实现安全项 | `app/api/chat/route.ts` 等 |
| 7 | 整卷流程 | `/diagnose` 工作流 |
| 8 | 收尾 | 去 `wip-` 前缀、更新 README |

## 9. 文档同步清单

以下既有文档需随本组协议同步修订：

| 文件 | 需改内容 |
|---|---|
| `doc/diagnose-file-intake.md` | 完整度判定口径改为「原题必需」 |
| `doc/user-settings.md` | 新增档位字段、设备标识重置入口 |
| `doc/browser-local-inference.md` | RAG 触发条件、语义缓存与聚类定位 |
| `doc/browser-local-ocr.md` | 删除「云端 OCR」表述，改为「本地识别 / 多模态识别」 |

### 9.1 本轮定稿后新增的待办（2026-11-11）

| 条目 | 依据 | 状态 |
|---|---|---|
| 证据可信度分级 + 识别结果回显确认 | `wip-diagnosis-model.md` §1.3 | ❌ |
| OCR 低置信强制确认（阈值待定） | 同上 | ❌ |
| §7 输出纪律三条禁令写入提示词 | `wip-diagnosis-model.md` §7 | ❌ |
| 「必须引用作答片段」后置校验（子串/近似匹配） | 同上 §7.3 | ❌ |
| 全本地 / 多模态 / 混合三档 + 代价提示 | `wip-product-vision.md` P4 | ❌ |
| `explain` 掌握度回路（明白了 / 还不懂） | `wip-agent-workflow.md` §4.3(a) | ❌ |
| 成本计量口径（每次诊断调用次数、token 区间） | 交付边界 D | ❌ |
| 演示脚本按「评委 3 分钟看懂诊断≠搜题」编排 | `wip-product-vision.md` §3.3 | ❌ |
| 首页视觉重构（结构已有，信息层级待定） | 空白 #6 | ❌ |
| 上下文裁剪（不设硬边界，长会话只保留当前题相关） | 空白 #5 | ❌ |

## 10. 待决策

- [ ] 英语 v1 是否确认为「不做」，多学科仅作架构预留
- [ ] RAG 触发阈值（建议按语料字数，如 > 3000 字）
- [ ] 设备标识字段确认为请求体 `user`
- [ ] `confidence` 判定依据（模型自评是否可信）
- [ ] 演示主线是否包含整卷流程
*（内容由AI生成，仅供参考）*
