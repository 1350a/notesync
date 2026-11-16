# notesync 文档导航

本目录是 notesync 业务协议的唯一事实来源：诊断流程、API 契约、数据模型、安全条文以这里为准。

项目简介、能力边界、技术栈、快速开始、环境变量、目录结构、开发规范见 [根 README](../README.md)；工程约定条文见 [AGENTS.md](../AGENTS.md)。本目录共 22 篇 Markdown（21 篇协议 + 本导航）。

> 除 `doc\help-about-.env.md` 外，本文件夹的文件均由AI生成

## 1. 读文档前先知道三件事

- **看强度分级**：每篇开头的约束强度分三级——硬约束、方向 D、假设 A（分级定义见 [product-vision.md](./product-vision.md) §0）。硬约束不可绕，方向与假设可被实现推翻。
- **状态行比正文权威**：正文写的是设计意图，条目的实装 / 挂账状态一律以 [implementation-status.md](./implementation-status.md) 为准。
- **未兑现的协议不删**：协议是目标，代码未跟上时保留协议并标状态，不靠删除掩盖差距。

## 2. 文档清单（按组）

### 2.1 产品与方向

| 文档                                     | 一句话说明                                          |
| ---------------------------------------- | --------------------------------------------------- |
| [product-vision.md](./product-vision.md) | 产品理念、约束强度分级、目标用户与演示主线 — 已定稿 |
| [demo-script.md](./demo-script.md)       | 3 分钟演示分镜与讲稿要点 — 已定稿                   |

### 2.2 诊断核心

| 文档                                       | 一句话说明                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| [diagnosis-model.md](./diagnosis-model.md) | 业务中间结构：错因枚举、完整度四要素、策略卡、提示阶梯与输出纪律 — 已定稿且已实装 |
| [agent-workflow.md](./agent-workflow.md)   | 七态状态机迁移表、追问预算、拒绝补充的降级出口 — 已定稿且已实装                   |
| [diagnose-paper.md](./diagnose-paper.md)   | 整卷诊断契约：切题 → 分类 → 逐题 → 汇总 — 已定稿且已实装                          |

### 2.3 文件与图片接入

| 文档                                                 | 一句话说明                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| [file-intake.md](./file-intake.md)                   | 文件上传统一接入契约（类型判定、体积上限、提取路径） — 已定稿且已实装 |
| [diagnose-file-intake.md](./diagnose-file-intake.md) | 诊断模式下的附件四类标签与组装规则 — 已定稿且已实装                   |
| [cloud-ocr.md](./cloud-ocr.md)                       | 云端 OCR 单段识别接口与图片外发提示 — 部分实装，两段管线挂账          |

### 2.4 端侧推理

| 文档                                                       | 一句话说明                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [browser-local-ocr.md](./browser-local-ocr.md)             | 浏览器端本地 OCR（tesseract.js）资产、自检与失败兜底 — 已定稿且已实装                 |
| [browser-local-inference.md](./browser-local-inference.md) | 端侧嵌入与 RAG：引擎、检索、触发阈值、内存租约 — 已实装，本地对话 v2 与语料侧阈值挂账 |

### 2.5 前端与用户态

| 文档                                   | 一句话说明                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| [mobile-ux.md](./mobile-ux.md)         | 移动端断点、输入区与气泡适配约定 — 已定稿                                        |
| [user-settings.md](./user-settings.md) | 设置项字段、默认档与思考档位映射 — 已实装，`temperature` / `systemPrompt` 未接线 |
| [chat-history.md](./chat-history.md)   | 会话历史本地持久化与导出 — 已定稿且已实装                                        |
| [tts.md](./tts.md)                     | 朗读协议：双云端引擎、清洗分段、接口契约 — 已实装，语速与本地合成挂账            |

### 2.6 能力接入

| 文档                                   | 一句话说明                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [tool-protocol.md](./tool-protocol.md) | 工具调用协议：注册、循环、native/text 双模式、`ask_user` 中断 — native 已实装，text 未通过、多工具并行挂账 |

### 2.7 安全

| 文档                                       | 一句话说明                                                            |
| ------------------------------------------ | --------------------------------------------------------------------- |
| [safety-protocol.md](./safety-protocol.md) | 安全硬约束条文：拦截码、三级处置、隐私明示 — 已定稿且已实装           |
| [safety-design.md](./safety-design.md)     | 判定的实现取舍：双侧拦截归一、注入特征口径、导出脱敏 — 已定稿且已实装 |

### 2.8 工程流程

| 文档                                                   | 一句话说明                                         |
| ------------------------------------------------------ | -------------------------------------------------- |
| [implementation-status.md](./implementation-status.md) | 实施状态总账，所有实装 / 挂账的唯一出处 — 持续更新 |
| [git-commit-convention.md](./git-commit-convention.md) | 提交粒度与 message 格式 — 已定稿                   |
| [help-about-.env.md](./help-about-.env.md)             | 环境变量手册：逐项含义、默认值与填错后果 — 已定稿  |

### 2.9 质量验证

| 文档                                                           | 一句话说明                                    |
| -------------------------------------------------------------- | --------------------------------------------- |
| [wrong-answer-set-template.md](./wrong-answer-set-template.md) | 错题集录入模板与诊断质量回归样本格式 — 已定稿 |

## 3. 按目的阅读路径

| 目的              | 阅读顺序                                                                  |
| ----------------- | ------------------------------------------------------------------------- |
| 第一次接触项目    | product-vision → diagnosis-model → agent-workflow → implementation-status |
| 改诊断逻辑        | diagnosis-model → agent-workflow → diagnose-paper → implementation-status |
| 改文件 / 图片链路 | file-intake → diagnose-file-intake → cloud-ocr → browser-local-ocr        |
| 改端侧推理        | browser-local-ocr → browser-local-inference → implementation-status §3    |
| 改前端交互        | mobile-ux → user-settings → chat-history → tts                            |
| 改工具接入        | tool-protocol → AGENTS.md                                                 |
| 改安全链路        | safety-protocol → safety-design → implementation-status §4                |
| 评审或演示        | product-vision → demo-script → implementation-status                      |
| 验证诊断质量      | wrong-answer-set-template → diagnosis-model → implementation-status       |
| 部署与配置        | help-about-.env → 根 README                                               |
| 提交代码          | git-commit-convention → AGENTS.md                                         |

## 4. 维护约定

| 约定     | 要求                                                                   |
| -------- | ---------------------------------------------------------------------- |
| 新增协议 | 沿用「一句话说明 + 状态行 + 约束强度」开头三件套，并在本页对应组补一行 |
| 状态变更 | 同步更新 implementation-status.md，不散落在正文里                      |
| 协议废弃 | 保留正文并标状态，不直接删除                                           |
| 链接改动 | 改文件名或移动文档后修正本页与根 README 的相对链接                     |
| 定位冲突 | 本目录不写项目介绍与技术栈，此类内容统一放根 README                    |
