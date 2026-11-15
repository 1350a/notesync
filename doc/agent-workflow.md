---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 0389a83fdf2fd477e56fb14bde9a8feb_b7b77fd7ddd011f1997d52540024e231
    ReservedCode1: xy41ionsI0d6OfbN6UA4hXUxZBiLoj4ntzs22dPBQyDaejAzjwUCJ31otylOjkBpTqjdJfrmCICh2CgR9m37yf8gqDAQ0C5edM+rfMVgsN+6uGr3QseKAlsZ/cyUhDkha2MNEcSzYUgQKJ2CQc/itLKAYsVmiaZtqtGOjnV7Zvk3VHG2kQdpjjXTWnM=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 0389a83fdf2fd477e56fb14bde9a8feb_b7b77fd7ddd011f1997d52540024e231
    ReservedCode2: xy41ionsI0d6OfbN6UA4hXUxZBiLoj4ntzs22dPBQyDaejAzjwUCJ31otylOjkBpTqjdJfrmCICh2CgR9m37yf8gqDAQ0C5edM+rfMVgsN+6uGr3QseKAlsZ/cyUhDkha2MNEcSzYUgQKJ2CQc/itLKAYsVmiaZtqtGOjnV7Zvk3VHG2kQdpjjXTWnM=
---

# 诊断工作流（状态机 / 追问预算 / 整卷）

> **状态：已实装（显式状态机 / 追问预算 / 整卷四步），本文作为行为约定继续有效。**
> 落点：`lib/diagnose/state-machine.ts`（纯函数迁移表）、`lib/diagnose/runtime.ts`（结构化判定与编排）、
> `app/api/chat/route.ts`（SSE 事件推导）、`app/api/diagnose-paper/route.ts`（整卷，契约见 `doc/diagnose-paper.md`）。
> 实装与本稿的差异：`strategize` 已合并进 `diagnose`（策略卡按 code 服务端组装，不再单独迁移）；`lookup_strategy` / `lookup_errorcause` 与切题一并内联进提示词，**未工具化**。
> 依赖：`diagnosis-model.md`（中间结构与错因表）。
> 现存实现：`lib/tools/loop.ts` 的多轮工具循环 + `app/api/chat/route.ts` 的 SSE 编排。本文在其上加**状态机**与**终止条件**，不改动既有工具协议。
>
> **约束强度**：分级说明见 `product-vision.md` §0。**状态划分、命名、轮数预算、整卷四步均为「方向 D」级**——实现时合并状态、改名、改步数都可以，只要「有显式状态、有追问预算、有终止条件」这三点成立；**`explain` 输出不得退化为解析为硬约束**（见 `diagnosis-model.md` §7）。

## 1. 为什么需要状态机

现有实现是「有工具就调工具」的多轮循环，没有显式状态。后果：

- 终止条件靠轮数兜底（`TOOL_MAX_ROUNDS`），语义上不是「诊断完成」；
- 无法表达「信息不足 → 补问 → 仍不足 → 降级」这类真实分支；
- 整卷场景无处安放。

因此需要一个轻量状态机，**状态迁移由结构化判定驱动，而非自由对话**。

## 2. 状态定义

```
intake ──► clarify ──► diagnose ──► explain ──► done
  │           │            │
  │           └─(拒绝补充)─┴──► L1_only ──► done
  └─(非数学题)────────────────────────────► reject ──► done
```

| 状态 | 输入 | 输出 | 迁移条件 |
|---|---|---|---|
| `intake` | 用户消息/图片 | 原题文本、是否数学题 | 有原题 → `clarify`；非数学 → `reject` |
| `clarify` | 原题 | 是否已有作答 | 有作答 → `diagnose`；无 → 用「常见错法清单」补问，一轮后仍无 → `L1_only` |
| `diagnose` | 原题 + 作答 | `errorCause`（主 + 次）、置信度、`StrategyCard` | 置信度达标 → `explain`；不达标 → 回 `clarify` 一次，仍未达标 → 低置信输出（仍进 `explain`） |
| `explain` | 诊断结果 | 分级提示（L1 起） | 用户点「继续」→ 逐级下降；点「明白了」→ `done`；点「还不懂」→ 自环（降到下一级）；用户终止 → `done` |
| `L1_only` | 原题 | L1 题目画像 + 声明 | 直接 `done` |
| `reject` | — | 固定话术 + 能力说明 | 直接 `done` |

## 3. 工具集

v1 只需三个工具（原生 Function Calling），沿用 `doc/tool-protocol.md` 的定义风格：

| 工具 | 作用 | 备注 | 实装决策 |
|---|---|---|---|
| `ask_user` | 补问（已实装） | 复用现有 `awaiting_user` 中断链路，不新造协议 | 保留 |
| `lookup_strategy` | 按错因 code 查策略卡 | **直查，不是检索** | **未工具化**：策略卡按 code 在服务端注入提示词（`lib/diagnose/strategies.ts`），省一次往返 |
| `lookup_errorcause` | 错因枚举表查询（供模型对齐 code） | 可合并进提示词，视上下文预算决定 | **未工具化**：14 条枚举直接内联（`lib/diagnose/error-causes.ts`） |

整卷场景额外需要 `split_questions`（切题），见 §5——同样**未工具化**，切题提示词内联在 `lib/diagnose/paper.ts`。

> 注：上述三者本质是本地常量查询，不走网络。实测未出现「内联后上下文超预算」的情况，故维持内联；若后续错因表扩张到影响上下文，再考虑工具化。

## 4. 追问预算与终止条件

### 4.1 追问预算

- 单次诊断最多 **2 轮**追问（`CLARIFY_BUDGET = 2`，可按档位调整）。
- 每次追问**必须绑定一个可验证推测**，禁止「你哪里不会」这类开放式提问。

  | 允许 | 禁止 |
  |---|---|
  | 「这题常见的错法是 A/B/C，你是哪种？」 | 「你哪里不会？」 |
  | 「我判断你在判别式符号上出错，对吗？」 | 「请详细描述你的思路」 |

- 预算耗尽 → 强制进入 `L1_only` 或低置信 L2，**不允许继续追问**。

### 4.2 终止条件（明确列出，避免无限循环）

1. 已输出 `DiagnosisResult` 且用户未继续索取 → `done`
2. 追问预算耗尽 → 强制收敛
3. 用户明确表示不用继续 → `done`
4. 工具轮数达 `TOOL_MAX_ROUNDS` → 走现存的「收敛请求」路径（追加 system 提示后做一次不带 tools 的请求）

### 4.3 收敛后的两条回路

#### (a) 掌握度回路（`explain` 自环）

结果输出后不断言成败，给一次极轻的确认：

| 用户选择 | 迁移 |
|---|---|
| 明白了 | `done` |
| 还是不太懂 | `explain` 自环，自动降到下一级提示 |
| 不选（直接问别的） | 按新意图走，不纠缠 |

成本是一次点击，收益是流程从「一次性输出」变成有回路的辅导。**不强制、不阻塞**——用户不点也能正常结束。

#### (b) 答案索取：不设门槛

**不做交互拦截**，不规定「必须看完 L1 才能要答案」，也不做防越狱式拦截。

理由：这是提示词工程的职责，不是状态机的职责。状态机加关卡只会制造摩擦，且用户总能绕过。

约束落在提示词层，见 `diagnosis-model.md` §7（禁令 + 作答片段引用的机械判据）。状态机只保证一点：**即使用户第一句就要答案，`explain` 输出仍走 §7 纪律**，不允许退化为整段解析。

## 5. 整卷诊断流程

### 5.1 为什么不能串行逐题

20 题串行 = 20 次模型调用，延迟与成本都失控。正确流程四步：

| 步骤 | 动作 | 调用特征 |
|---|---|---|
| ① 切题 | 图片/PDF → 题号、题干、作答、题型 | 轻任务，低 `max_tokens`，结构化输出 |
| ② 分类 | 每题打错因候选标签 | **本地可做**：规则 + 嵌入聚类，不花 token |
| ③ 同类共享诊断 | 同一错因只诊断一次 | 主开销集中在此，按错因种类数计 |
| ④ 汇总 | 逐题引用共享结论 + 全局统计 | 一次调用 |

预期 20 题可压到 4~6 次调用。

### 5.2 降级路径

若 ① 切题失败（图片质量差、版面复杂），**不静默继续**：提示用户改用手动分题或单题模式，并说明原因。宁可少做，不可错做。

## 6. 工具调用模式现状

| 模式 | 现状 | 处理 |
|---|---|---|
| `native`（原生 Function Calling） | 已实装，默认 | 正式路径 |
| `text`（围栏文本协议） | 已实装但**仅 `custom` provider 下启用**；实测未通过 | **标为实验通道，v1 不作为交付项**；文档如实标注 |

> 排查记录：`app/api/chat/route.ts` 中 `mode` 仅在 `provider.name === 'custom' && CUSTOM_TOOL_MODE === 'text'` 时为 `text`，其余一律 `native`。因此「text 模式没生效」首先应确认 mode 是否真的切到 text，再谈模型能力。
>
> 缺口：`ProviderModel` 目前只有 `acceptsImages` / `free`，**缺 `supportsTools` 能力位**，业务层无法自动判断该走哪条模式。v1 不修，记为待办。

## 7. 待办

- [x] 状态机落地位置：`lib/diagnose/state-machine.ts`，纯函数，便于测试。
- [x] `DiagnosisResult` 与状态迁移的契约测试（`test/lib/diagnose/contract.test.ts`、`state-machine.test.ts`）。
- [x] `lookup_strategy` 先内联还是工具化——已定为内联，见 §3。
- [x] 整卷流程 ① 切题的结构化输出 schema 设计（`lib/diagnose/paper.ts`，契约见 `doc/diagnose-paper.md`）。
- [ ] `supportsTools` 能力位（挂账，v1 不做）。
- [ ] text 模式修复（挂账，v1 不做）。
*（内容由AI生成，仅供参考）*
