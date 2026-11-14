---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 0389a83fdf2fd477e56fb14bde9a8feb_e4cd277fdd0d11f1997d52540024e231
    ReservedCode1: 31d3IC0/A2PbQxovg7hAr2O4gG/P3Oq5TtrWVqiqYkidplgJsH24NAHY7zZjzNaMlD0OCaygL5aORN2xcWp+C7RJLMyYQf66bc8oH5vyAzGHOPeZV+lvtzRTsu67Qg4Xy4Rsu+OzPoUZK/7y8R7g4f18WTKGiq4nUOyQ2xz403AO4k7ssYa/bFPkXos=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 0389a83fdf2fd477e56fb14bde9a8feb_e4cd277fdd0d11f1997d52540024e231
    ReservedCode2: 31d3IC0/A2PbQxovg7hAr2O4gG/P3Oq5TtrWVqiqYkidplgJsH24NAHY7zZjzNaMlD0OCaygL5aORN2xcWp+C7RJLMyYQf66bc8oH5vyAzGHOPeZV+lvtzRTsu67Qg4Xy4Rsu+OzPoUZK/7y8R7g4f18WTKGiq4nUOyQ2xz403AO4k7ssYa/bFPkXos=
---

# notesync — 错题认知诊断引擎

> 面向学生的错题 AI 诊断 Web 应用：既支持单题多轮对话深挖薄弱点，也支持批量试卷诊断。
> **本地能力（图片 OCR、语义嵌入与知识检索）全部在浏览器内完成，图片与语料不出设备**；
> 对话生成由可配置的云端模型服务承担（DeepSeek / 智谱 / 自定义 OpenAI 兼容端点）。

## 1. 项目定位与能力边界

- **诊断而非搜题**：错题不是"给答案"，而是通过提问逐步收敛到知识点层面的薄弱环节，产出可执行的复习建议。
- **本地能力底座**：OCR（tesseract.js）与 embedding + RAG（Transformers.js + onnxruntime-web）在 Web Worker 内运行，模型与 wasm 资产**自托管**，运行时不引用任何 CDN。
- **诚实接线**：未实装的能力不出现在界面上；保留的占位行一律禁用并标注"未实装"（`AGENTS.md` §8）。

边界说明（**重要，勿误读为"完全离线"**）：

| 能力 | 数据是否离开设备 | 说明 |
| --- | --- | --- |
| OCR（本地） | 否 | 图片在浏览器内转文字，服务端只分发静态资产 |
| 知识检索（RAG） | 否 | 语料与查询向量存本机 IndexedDB；仅命中的**文本片段**随消息上行 |
| 对话生成 | 是 | 由所配置的云端 Provider 处理；本分支不提供本地小模型对话（v2 挂账） |

因此准确表述是：**本地能力零外联、模型资产自托管、无需联网即可完成 OCR 与检索**；而"对话生成完全离线"并不成立，历史文档中的"支持完全离线运行"属过时说法，请以本表为准。

## 2. 能力现状

| 模块 | 状态 | 位置 |
| --- | --- | --- |
| 单题多轮对话诊断 | 实装 | `app/chat`、`hooks/useChat.ts` |
| 批量试卷 / 文件诊断 | 实装 | `app/diagnose`、`lib/diagnose/` |
| 本地 OCR（chi_sim） | 实装 | `lib/ocr/local.ts`、`app/ocr` 自检页 |
| 图片发送模式派生（直传 / 本地 OCR） | 实装 | `lib/ocr/image-handling.ts` |
| 浏览器端 embedding + 知识检索（RAG） | 实装（用户显式开启） | `lib/local/` |
| 工具调用（native / text 双模式，含 `ask_user` 中断） | 实装 | `lib/tools/` |
| 三家 Provider 路由与模型列表探测 | 实装 | `lib/provider/` |
| 设置（主题 / 默认模型 / 本地能力 / 数据管理） | 实装 | `lib/settings/`、`components/settings/` |
| 基础版 CSP 响应头 | 实装 | `next.config.ts` |
| 本地小模型对话、云 OCR、云端 embedding | 挂账 | 见 `doc/browser-local-inference.md` §8、`doc/browser-local-ocr.md` §7 |

## 3. 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | Next.js 16.4.3（App Router + Turbopack）+ React 19.3.0 |
| 语言 | TypeScript 5（`strict`，禁 `any` / `@ts-ignore`） |
| 样式 | Tailwind CSS 4、shadcn 风格自建组件 |
| 模型接入 | DeepSeek / 智谱 BigModel / 自定义 OpenAI 兼容端点（服务端环境变量注入密钥） |
| 本地 OCR | tesseract.js 7（LSTM，纯 wasm，Web Worker） |
| 本地嵌入 | @huggingface/transformers 4.3.2 + onnxruntime-web 1.31.0-dev.20260914-8d85527a0（`bge-small-zh-v1.5`，512 维） |
| 存储 | localStorage（设置、会话）+ IndexedDB（RAG 向量） |

## 4. 环境要求

- **Node.js ≥ 22.6**：`scripts/*.ts` 冒烟脚本直接用 `node --experimental-strip-types` 运行 TypeScript（22.6 起提供该能力）。当前开发验证版本 22.12.0；更低版本会在执行 `npm run smoke:*` 时失败。
- **npm ≥ 10**（随 Node 22 附带即可）。
- **浏览器**：Chrome / Edge 近期版本。本地嵌入优先 WebGPU（`shader-f16` 可用时走 q4f16），不可用时自动回退 WASM（q8）；站点未配置 COOP/COEP，ORT 单线程加载 asyncify 档，资产清单已同步该档。
- **磁盘**：`public/models` 约 55MB（q8 约 24MB + q4f16 约 30MB）、`public/ocr` 约 15MB，均为派生产物，不入库。

## 5. 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 生成两类本地运行时资产（必需，见 §6）
npm run local:assets
npm run ocr:assets

# 3. 配置环境变量（至少填一家 Provider 的 Key）
cp .env.example .env        # Windows: copy .env.example .env

# 4. 启动开发服务器
npm run dev                 # http://localhost:3000

# 5. 生产构建与启动
npm run build
npm run start
```

不配置任何 Key 时 `/api/models` 返回 `unconfigured`，界面提示去填 `.env`；对话链路不可用，但本地 OCR 自检页（`/ocr`）仍可验证。

## 6. 两步必需的资产操作

两个脚本都是**幂等、离线可重复执行**的资产派生步骤，产物目录均被 `.gitignore` 忽略，因此 `npm install` 之后必须各跑一次。

### 6.1 `npm run local:assets`

- 作用：从 Hugging Face 下载 `onnx-community/bge-small-zh-v1.5-ONNX` 模型（`HF_MIRROR` 可切换镜像，如 `https://hf-mirror.com`），并从根依赖 `node_modules/onnxruntime-web/dist` 复制 ORT 的 wasm/glue 到 `public/models/ort/`。
- 产物：`public/models/bge-small-zh-v1.5/`（config / tokenizer / 两档权重含 `_data`）、`public/models/ort/`（含 asyncify 档共 6+ 文件）。
- 校验：按实测体积设下限，拦截截断与 HTML 错误页；复制 ORT 前校验已安装版本与 `package.json` 声明一致，版本漂移直接失败退出。
- **失败后果**：`checkLocalAssets()` 返回 `ready: false` 并列出缺失路径，「设置 → 本地能力」中的知识检索开关被禁用、本地引擎显示资产缺失与修复命令；聊天发送时 RAG 静默跳过（消息照常发送，不阻断）。若只缺 asyncify 档，会在引擎实例化阶段报 `Failed to fetch dynamically imported module`。

### 6.2 `npm run ocr:assets`

- 作用：把 `tesseract.js` 的 worker、6 个 core wasm 变体与仓库内 `tessdata/` 语言包复制到 `public/ocr/`。
- 产物：`public/ocr/worker/`、`public/ocr/core/`、`public/ocr/tessdata/`。
- **失败后果**：`checkOcrAssets()` 返回 `ready: false`，`/ocr` 自检逐项报 FAIL；聊天/诊断侧不做资产前置门禁，而是在识别阶段失败——「图片处理」选「优先本地OCR」时该图片会被**阻断发送**并逐张列明原因（附修复命令），不会静默改为原图直传，也不会静默回落云 OCR。

## 7. 环境变量

模板见 [.env.example](./.env.example)。密钥只能来自服务端环境变量，禁止写入客户端代码或存储（`AGENTS.md` §7）。

每个变量的语义、取值口径、必填判定、常见组合与排障对照见 [doc/help-about-.env.md](./doc/help-about-.env.md)（含本表未列的 `TRIM_BUDGET_CHARS`、`USER_FIELD_ENABLED`、`MOCK_OCR`）；下表只列最常用的概况。

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 三选一 | — | DeepSeek 官方 Key（OpenAI 兼容，`{BASE_URL}/chat/completions`） |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | 自定义端点 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-flash` | 该 Provider 默认选中模型（`deepseek-v4-flash` 仅过渡别名，勿填） |
| `ZHIPU_API_KEY` | 三选一 | — | 智谱 BigModel Key |
| `ZHIPU_BASE_URL` | 否 | `https://open.bigmodel.cn/api/paas/v4` | 自定义端点 |
| `ZHIPU_MODEL` | 否 | `glm-5.3` | 该 Provider 默认选中模型 |
| `CUSTOM_API_KEY` | 三选一 | — | 自定义 OpenAI 兼容端点 Key |
| `CUSTOM_BASE_URL` | 否 | — | 自定义端点地址（须含版本前缀，如 `.../v1`） |
| `CUSTOM_MODEL` | 否 | — | 自定义模型名 |
| `TOOLS_ENABLED` | 否 | `true` | 是否向模型下发工具集 |
| `TOOL_MAX_ROUNDS` | 否 | `3` | 工具调用最大循环轮数（防死循环） |
| `CUSTOM_TOOL_MODE` | 否 | `native` | `native`（原生 tools 协议）/ `text`（文本 JSON 协议） |
| `CUSTOM_ALLOW_IMAGES` | 否 | `false`（不设置或非 `1` 均视为 false） | 自定义端点是否接受图片直传；默认纯文本，图片先经本地 OCR 转文字，避免 `image_url` 被纯文本端点 400 |
| `MOCK_MODEL` | 否 | `0` | 置 `1` 时不调用任何上游，仅回显组装后的发送结构（零 token 验证上传 → 组装 → 发送链路） |
| `MOCK_IMAGE_MODE` | 否 | 空 | MOCK 下的图片投喂方式：`multimodal` / `text-only` |
| `HF_MIRROR` | 否 | — | 仅 `npm run local:assets` 使用，模型下载镜像基址 |

`.env.example` 底部以注释保留了已停用旧链路（`lib/harness`、`lib/agent`、`lib/rag`、`lib/ocr.ts`、`lib/pdf.ts`）的历史参数，当前代码不再读取。

## 8. 分支与质量门禁约定

- **当前工作分支**：`beta/browser-ocr-planb`（浏览器本地能力方向的 beta 线：本地 OCR + 浏览器端 embedding/RAG）。协议文档中若出现历史方向名 `feat/browser-ai-inference`，指同一方向的早期命名。
- **质量门禁**（`AGENTS.md` §5）：`npm run lint` 与 `npm run build` **均须退出码 0** 才算完成；提交前另跑 `npx tsc --noEmit`。任一失败先修，禁止只跑一项就宣称完成。
- **冒烟脚本**（零依赖，`node --experimental-strip-types` 直跑）：`smoke:tools` / `smoke:adapters` / `smoke:loop` / `smoke:files` / `smoke:chat` / `smoke:settings` / `smoke:rag` / `smoke:xss`，另有 `scan:xss`。
- **提交纪律**（`AGENTS.md` §6）：一文件一 commit；`git add` 与 `git commit` 分两行执行；message 形如 `<type>: <中文描述>`，`<type>` ∈ `feat|fix|refactor|style|docs|test|chore|revert`。
- **类型纪律**（§3）：`strict` 不放松，禁 `any` 与 `@ts-ignore`。
- **协议先行**（§9）：诊断流程、API 契约、事件结构、数据模型等业务协议写在 `doc/`，**改协议先改 doc 再改代码**。

## 9. 目录结构

```
notesync/
├── app/
│   ├── page.tsx                # 首页
│   ├── chat/page.tsx           # 单题对话诊断（SSE 流式）
│   ├── diagnose/               # 批量试卷/文件诊断
│   ├── ocr/page.tsx            # 本地 OCR 自检与试用
│   └── api/
│       ├── chat/route.ts       # 对话 SSE（附件/OCR/RAG/工具编排）
│       └── models/route.ts     # 三家 Provider 模型列表与健康状态
├── components/                 # chat / settings / layout / ui 组件
├── hooks/                      # useChat、useModels、代码高亮
├── lib/
│   ├── local/                  # 浏览器端推理：assets / engine / embedding / worker / rag
│   ├── ocr/                    # 本地 OCR 服务与图片发送模式派生
│   ├── provider/               # deepseek / zhipu / custom 路由与探测
│   ├── tools/                  # 工具调用（registry / adapters / loop / builtin）
│   ├── chat/                   # 请求体校验与消息组装
│   ├── diagnose/               # 附件分类、提取、组装
│   ├── settings/               # 设置模型、存储、主题
│   └── agent/ harness/ rag/    # 历史诊断链路（已停用，保留源码）
├── scripts/                    # 资产派生脚本 + 冒烟/扫描脚本
├── doc/                        # 业务协议文档（唯一事实来源）
├── public/models、public/ocr   # 派生产物（不入库，由 §6 两步生成）
├── tessdata/                   # OCR 语言包源文件（入库）
├── AGENTS.md                   # 工程约定（目录边界、类型、门禁、提交纪律）
└── next.config.ts              # CSP、Turbopack、serverExternalPackages
```

## 10. 文档索引

`doc/` 是业务协议的唯一事实来源，改协议须先改文档再改代码。

| 文档 | 内容 |
| --- | --- |
| [doc/browser-local-ocr.md](./doc/browser-local-ocr.md) | 浏览器端本地 OCR 协议：选型、资产分发、服务契约、能力页验收、`imageTexts` 接入、Provider 能力默认值 |
| [doc/browser-local-inference.md](./doc/browser-local-inference.md) | 浏览器端本地推理协议：embedding + RAG、ORT 版本口径与资产自托管、服务契约、检索算法、`ragContexts` 契约、设置联动、挂账 |
| [doc/user-settings.md](./doc/user-settings.md) | 用户设置协议：`UserSettings` 结构、normalize 规则、存储接口、客户端标识、UI 分区与实装状态 |
| [doc/tool-protocol.md](./doc/tool-protocol.md) | 工具调用协议：native / text 双模式、`ask_user` 中断语义、SSE 事件扩展、错误码、扩展点与实现状态 |
| [doc/diagnose-file-intake.md](./doc/diagnose-file-intake.md) | 诊断模式文件接入契约：四类标签、判定与提取规则、请求体、组装产物、MOCK 调试开关 |
| [doc/diagnose-paper.md](./doc/diagnose-paper.md) | 整卷诊断协议：请求体、SSE 事件序列、四步流程（识卷 → 逐题 → 汇总 → 报告）、`stats` 口径、MOCK 标注 |
| [doc/product-vision.md](./doc/product-vision.md) | 产品理念：诊断 vs 解析的分界、三档路径（全本地 / 多模态 / 混合）、演示主线、非目标 |
| [doc/demo-script.md](./doc/demo-script.md) | 3 分钟演示分镜：诊断≠搜题主线、单题追问阶梯与错因、整卷四步、本地优先与外发代价、讲者禁忌与事故兜底 |
| [doc/diagnosis-model.md](./doc/diagnosis-model.md) | 诊断业务中间结构：错因表（14 条）、完整度四要素、策略卡、提示阶梯、输出纪律三条禁令 |
| [doc/agent-workflow.md](./doc/agent-workflow.md) | 诊断工作流协议：七状态迁移表、追问预算、掌握度回路、整卷四步划分与降级语义 |
| [doc/safety-protocol.md](./doc/safety-protocol.md) | 安全协议：三级处置、上游拦截归一、拦截后历史回滚、输入侧词表、设备标识 `user`、图片上传明示 |
| [doc/safety-design.md](./doc/safety-design.md) | 安全设计说明：三层纵深、不做关键词黑名单的决策与理由、trace 证据字段、演示路径与已知局限 |
| [doc/implementation-status.md](./doc/implementation-status.md) | 实施状态总账：逐条 ✅ / 🟡 / ❌ / 🧊 与代码落点、文档同步清单、交付顺序、待决策 |
| [doc/mobile-ux.md](./doc/mobile-ux.md) | 移动端适配协议：断点、触屏热区、键盘与安全区、发送区与滚动行为 |
| [doc/wrong-answer-set-template.md](./doc/wrong-answer-set-template.md) | 错题集录入模板：字段定义与示例 |
| [doc/help-about-.env.md](./doc/help-about-.env.md) | 环境变量手册：变量总表与分组、Provider 配置与模型口径、工具调用/上下文/调试开关、历史遗留参数、常见配置组合、取值口径陷阱、排障对照 |
| [doc/TECHNICAL_DOC.old.md](./doc/TECHNICAL_DOC.old.md) | 已归档的旧版技术文档（对应"简易重构前"的实现，含本地 ollama 回退链路），仅作历史参考 |

## 11. 已知挂账

- 本地小模型对话（v2，Qwen3-0.6B / Qwen2.5-0.5B-Instruct ONNX 待评测）、云端 embedding、云 OCR 两段管线。
- `disposeLocalEngine()` 已接线：走 `lib/local/engine-lease.ts` 的租约引用计数，`acquireLocalEngine` / `releaseLocalEngine` 归零时释放，能力页、设置分区与聊天链路共用同一份租约；OCR 侧 `disposeOcrWorker()` 已在 `/ocr` 页面接入。
- 设置中的 `generation.thinkingEffort` / `generation.maxTokens` 已接线：前者按 provider 映射为 `reasoning_effort` / `thinking.type`（custom 不发），后者映射为 `max_tokens`（custom 不发；设置页三档预设 1024 / 4096 / 8192 或跟随模型默认）；`generation.temperature`、`systemPrompt`、语言、朗读音色仍未接线（服务端注入待做）。会话历史已改为浏览器本地持久化（`doc/chat-history.md`），服务端 `/api/sessions` 与跨设备同步不做。
- 工具调用：多工具并行、外部 MCP server 注册未实现。
- 思考面板与 trace 导出：面板改三级展示（默认折叠 → 前 400 字预览 +「共 N 字」→「展开完整推理」），避免长推理一次铺满屏幕；trace 的 `reasoning` 仍全量落盘（保留本地分析能力），只在导出出口经 `lib/safety/redact.ts` 的 `redactTraceText()` 脱敏副本，公式/代码/URL 走白名单不改写（详见 `doc/safety-design.md` §5.1）。脱敏靠词表与句式，新增内部常量名需同步补表。
- Safari WebGPU EP 内存问题（onnxruntime #26827）跟踪中，届时可能对 Safari 强制 q8/WASM。

---

本项目为 AI Web 大赛参赛作品，代码原创；密钥仅经环境变量注入，不随仓库公开。本文档为工程说明，若与 `doc/` 协议或代码实现冲突，以代码与 `doc/` 为准。
*（内容由AI生成，仅供参考）*
