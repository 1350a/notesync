# notesync — 错题认知诊断引擎

版本 v1.0.2 · 请注意演示分支为 `demo` · AI Web 大赛参赛作品

## 1. 项目简介

notesync 面向数学错题做**认知诊断**，而不是搜题给答案：用户提交原题（可选附作答），系统判定错因、给出对应策略卡与分层提示，并把学习过程留成可复习的诊断记录。

边界：

- **诊断而非答疑**：产出是错因、策略与复习建议，不直接代做题目。
- **端侧可控**：向量检索在浏览器内跑（Web Worker），支持本地 OCR（默认云端识别，可一键切本地）；模型与 wasm 自托管，不引用 CDN；对话生成由云端 Provider 承担，密钥只在服务端。

判断与展示口径以源码与 [doc/implementation-status.md](./doc/implementation-status.md) 为准；本文件与 `doc/` 冲突时，以代码与 `doc/` 为准。

## 2. 功能概览

| 能力                                                       | 状态               |
| ---------------------------------------------------------- | ------------------ |
| 单题多轮对话诊断（完整度门槛 → L1 画像 / L2 错因）         | 已实装             |
| 数学错因枚举（14 条）+ 策略卡按 code 服务端注入            | 已实装             |
| 提示阶梯 L1/L2/L3 + 追问预算 + 强制收敛                    | 已实装             |
| 整卷诊断（切题 → 分类 → 逐题 → 汇总）                      | 已实装             |
| 本地 OCR（tesseract.js chi_sim，含 `/ocr` 自检面板）       | 已实装             |
| 图片发送模式派生（多模态直传 / 本地转文字自动路由）        | 已实装             |
| 浏览器端 embedding + RAG（用户显式开启）                   | 已实装             |
| 工具调用（native 模式，含 `ask_user` 中断回填）            | 已实装             |
| 三家 Provider 路由与模型列表探测                           | 已实装             |
| TTS 朗读（双云端引擎，消息气泡按钮）                       | 已实装             |
| 会话历史本地持久化 + Markdown 导出                         | 已实装             |
| 设置（主题、默认模型、思考档位与预算、本地能力、数据管理） | 已实装             |
| 基础版 CSP 与安全响应头                                    | 已实装             |
| text 工具模式（仅 custom 端点）                            | 实测未通过，未启用 |
| 本地小模型对话、云端 embedding、云 OCR 两段管线            | 挂账（v2）         |

## 3. 技术架构

| 分层       | 实现与落点                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架       | Next.js 16.4.6（App Router + Turbopack）+ React 19.3.0                                                                                                        |
| 语言与样式 | TypeScript 5（strict，禁 `any` / `@ts-ignore`）、Tailwind CSS 4 + 自建 shadcn 风格组件                                                                        |
| 前端编排   | `hooks/useChat.ts` 消费 SSE，驱动七态诊断状态机与拦截回滚                                                                                                     |
| 服务端     | `app/api/` 六条路由：`chat`（SSE 主入口）、`diagnose-paper`、`models`、`ocr`、`parse-doc`、`tts`                                                              |
| 诊断核心   | `lib/diagnose/`：状态机、runtime 编排、错因表、策略卡、按态提示词装配、提交前校验                                                                             |
| 模型接入   | `lib/provider/`：DeepSeek、智谱 BigModel、自定义 OpenAI 兼容端点；密钥仅服务端环境变量注入                                                                    |
| 端侧推理   | `lib/local/`（Transformers.js + onnxruntime-web，bge-small-zh-v1.5，512 维，WebGPU 优先、回退 WASM）、`lib/ocr/local.ts`（tesseract.js 7 LSTM wasm + Worker） |
| 文件接入   | `lib/intake/`（PDF 文字层、DOCX 等统一提取）、`lib/parse/`                                                                                                    |
| 存储       | localStorage（设置、会话、trace）+ IndexedDB（RAG 向量、模型缓存）                                                                                            |
| 安全       | `lib/safety/`：`content_blocked` 归一判定、三级处置话术、提示注入特征、导出脱敏；`next.config.ts` CSP 基线                                                    |

技术栈要点：

| 项       | 取值                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 对话模型 | DeepSeek（`deepseek-flash`、`deepseek-v4-pro`）、智谱（`glm-5.3-flash`、`glm-5.3-flashx`、`glm-5.3`）、自定义 OpenAI 兼容模型 |
| 本地 OCR | tesseract.js 7（LSTM，纯 wasm，Web Worker，chi_sim）                                                                          |
| 本地嵌入 | @huggingface/transformers 4.3.2 + onnxruntime-web 1.31.0-dev.20260914-8d85527a0，bge-small-zh-v1.5                            |
| 文档解析 | pdfjs-dist 5.6.205、mammoth、word-extractor                                                                                   |
| 渲染     | react-markdown + KaTeX（数学公式）+ rehype-sanitize（净化）                                                                   |
| 测试     | vitest（58 个测试文件）                                                                                                       |

## 4. 快速开始

| 要求           | 说明                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Node.js ≥ 22.6 | `local:assets` 脚本用 `--experimental-strip-types` 直接运行 TypeScript                          |
| npm ≥ 10       | 依赖安装与脚本执行                                                                              |
| 浏览器         | Chrome / Edge 近期版本；本地嵌入优先 WebGPU（`shader-f16` 可用时走 q4f16），不可用自动回退 WASM |
| 磁盘           | `public/models` 约 55MB、`public/ocr` 约 15MB，均为派生产物，不入库                             |

```bash
npm install           # postinstall 自动复制 pdf.js 资产
npm run local:assets  # 下载 bge-small-zh-v1.5 与 ORT wasm 到 public/models
npm run ocr:assets    # 复制 tesseract worker / core wasm / tessdata 到 public/ocr
cp .env.example .env  # 按 5. 环境变量填一家 Provider 的 Key
npm run dev           # 开发服务
```

生产构建：`npm run build` 后 `npm run start`。

未配置任何 Key 时，`/api/models` 返回 `unconfigured`，界面提示去设置或补环境变量。

两个资产脚本失败时的可见后果：

| 脚本           | 失败后果                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `local:assets` | `checkLocalAssets()` 返回 `ready: false`，知识检索开关被禁用，聊天时 RAG 静默跳过                              |
| `ocr:assets`   | `checkOcrAssets()` 返回 `ready: false`，`/ocr` 自检逐项 FAIL；"优先本地 OCR"模式下图片被阻断发送并逐张列明原因 |

## 5. 环境变量

模板见 [.env.example](./.env.example)，完整说明见 [doc/help-about-.env.md](./doc/help-about-.env.md)。密钥只能来自服务端环境变量，禁止写入客户端代码或提交到仓库。

| 变量                                                      | 说明                                                      |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `DEEPSEEK_API_KEY`                                        | DeepSeek 密钥（三家 Provider 至少配一家）                 |
| `DEEPSEEK_BASE_URL`                                       | 默认 `https://api.deepseek.com`                           |
| `DEEPSEEK_MODEL`                                          | 默认 `deepseek-flash`                                     |
| `DEEPSEEK_SAFETY_CHECK`                                   | `high` 开启服务端内容审核；`low` / `off` / 注释 = 不发送  |
| `ZHIPU_API_KEY`                                           | 智谱 BigModel 密钥                                        |
| `ZHIPU_BASE_URL`                                          | 默认 `https://open.bigmodel.cn/api/paas/v4`               |
| `ZHIPU_MODEL`                                             | 默认 `glm-5.3-flash`                                      |
| `CUSTOM_API_KEY` / `CUSTOM_BASE_URL` / `CUSTOM_MODEL`     | 自定义 OpenAI 兼容端点的密钥、地址与模型名                |
| `TOOLS_ENABLED`                                           | `true` / `false`，关闭后不执行工具调用                    |
| `TOOL_MAX_ROUNDS`                                         | 工具循环最大轮数，默认 5                                  |
| `CUSTOM_TOOL_MODE`                                        | `native`（默认）/ `text`；text 模式实测未通过，不建议启用 |
| `CUSTOM_ALLOW_IMAGES`                                     | `1` 允许原图直传自定义端点；`0` 走本地 OCR 转文字         |
| `TRIM_BUDGET_CHARS`                                       | 上下文裁剪预算，默认 24000；`0` 表示禁用裁剪              |
| `USER_FIELD_ENABLED`                                      | `1` 随请求透传设备标识 `user` 字段                        |
| `HF_MIRROR`                                               | 模型下载镜像，默认 `https://huggingface.co`               |
| `MOCK_MODEL` / `MOCK_OCR` / `MOCK_PARSE_DOC` / `MOCK_TTS` | 零 token 调试开关，置 `1` 走占位实现                      |
| `MOCK_IMAGE_MODE`                                         | 图片外发档位调试值，留空为自动派生                        |

## 6. 目录结构

```text
notesync/
├── app/
│   ├── (main)/          # 页面组：chat、diagnose、local、ocr
│   ├── api/             # chat、diagnose-paper、models、ocr、parse-doc、tts
│   └── layout.tsx / page.tsx / globals.css / error.tsx / not-found.tsx
├── components/          # chat、layout、settings、ui、upload
├── hooks/               # useChat、useLocalEngine、useModels、useTts、useMediaQuery
├── lib/
│   ├── diagnose/        # 状态机、runtime、错因表、策略卡、提示词、提交校验
│   ├── tools/           # 工具注册、循环、native/text 适配器
│   ├── provider/        # DeepSeek / 智谱 / 自定义 OpenAI 兼容
│   ├── local/           # 端侧嵌入与 RAG（engine、rag/search、rag/gate）
│   ├── ocr/             # 本地 OCR、图片模式派生
│   ├── intake/          # 文件接入与提取（含 extract-pdf）
│   ├── safety/          # 拦截判定、话术、注入特征、导出脱敏
│   └── chat/ config/ history/ markdown/ mock/ parse/ settings/ tts/ ui/
├── store/               # zustand：useChatStore、useSettingsStore、useTtsStore
├── scripts/             # 资产复制（local/ocr/pdfjs）与冒烟脚本
├── test/                # vitest 单元测试
├── doc/                 # 业务协议 21 篇，导航见 doc/README.md
├── public/              # 静态资源；models/、ocr/ 为派生产物（不入库）
├── tessdata/            # OCR 语言包源
└── .github/workflows/   # CI 门禁
```

## 7. 团队信息

- **团队名称**：破晓纪元
- **团队编号**：41818
- **所属院校**：马鞍山学院
- **参赛组别**：B组
- **组队人数**：3人

## 8. 开发规范

质量门禁（任一项非 0 退出码即不可提交）：

| 命令               | 要求     |
| ------------------ | -------- |
| `npm run lint`     | 退出码 0 |
| `npx tsc --noEmit` | 退出码 0 |
| `npm test`         | 全绿     |
| `npm run build`    | 退出码 0 |

- **冒烟脚本**：共 12 项（`smoke:tools` / `adapters` / `loop` / `files` / `intake` / `chat` / `settings` / `ocr` / `tts` / `rag` / `safety` / `xss`），另有 `scan:xss` 静态扫描。CI 实跑 11 项，`smoke:ocr` 需真实云端 OCR Key 与网络，本地按需手跑。
- **CI**：`.github/workflows/ci.yml` 在 `dev` / `main` 的 push 与 PR 上依次执行 lint → tsc → test → build → 11 项冒烟，超时 20 分钟；CI 不执行 `local:assets` / `ocr:assets`。
- **提交纪律**：一文件一 commit，message 形如 `<type>(<scope>): <中文描述>`，type ∈ `feat` | `fix` | `refactor` | `style` | `docs` | `test` | `chore` | `revert`。
- **类型纪律**：strict 不放松，禁 `any` 与 `@ts-ignore`。
- **协议先行**：诊断流程、API 契约、数据模型等业务协议先写 `doc/` 再写代码，改协议先改文档。
- **诚实接线**：未实装能力不出界面，占位项禁用并标注"未实装"。
- **密钥纪律**：只经服务端环境变量注入，不写客户端代码、不进仓库、不写入日志与导出文件。

## 9. 文档索引

`doc/` 共 22 篇 Markdown（21 篇协议 + 导航），是业务协议的唯一定义处；完整清单与按目的阅读路径见 [doc/README.md](./doc/README.md)。常读几篇：

| 文档                                                               | 内容                                     |
| ------------------------------------------------------------------ | ---------------------------------------- |
| [doc/implementation-status.md](./doc/implementation-status.md)     | 实施状态总账，实装 / 挂账以免为准        |
| [doc/product-vision.md](./doc/product-vision.md)                   | 产品理念、约束强度分级、演示主线         |
| [doc/diagnosis-model.md](./doc/diagnosis-model.md)                 | 错因枚举、完整度四要素、策略卡、输出纪律 |
| [doc/agent-workflow.md](./doc/agent-workflow.md)                   | 七态状态机、追问预算与整卷四步           |
| [doc/diagnose-paper.md](./doc/diagnose-paper.md)                   | 整卷诊断契约（切题、分类、汇总）         |
| [doc/safety-protocol.md](./doc/safety-protocol.md)                 | 安全硬约束条文                           |
| [doc/safety-design.md](./doc/safety-design.md)                     | 拦截判定与脱敏实现说明                   |
| [doc/browser-local-ocr.md](./doc/browser-local-ocr.md)             | 浏览器端本地 OCR 协议                    |
| [doc/browser-local-inference.md](./doc/browser-local-inference.md) | 浏览器端本地推理与 RAG 协议              |
| [doc/tool-protocol.md](./doc/tool-protocol.md)                     | 工具调用协议                             |
| [doc/help-about-.env.md](./doc/help-about-.env.md)                 | 环境变量手册                             |

---

本项目为 AI Web 大赛参赛作品，代码原创；密钥仅经环境变量注入，不随仓库公开。
