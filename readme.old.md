---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 26846db51993bfa99bd7045d69d41c5a_a4a9827ed20011f1992e525400638852
    ReservedCode1: UPOfkS0/S7UiXujMMfzgidmlkKQQkWtnNcrYQbgrcXI4AUzXt/vpHMBOO8rTQJNpWIDHjUziuGYeYpX7uJ90Dt8N8ALbuy8TSUDwoQEkHPyBnlNorUA5/C6wYF3no/GoaV1kdrkniG8e7pwFsvqAXADeU3IGTLySgKbrNsV8RGvErmF9AAzj4O9mYHQ=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 26846db51993bfa99bd7045d69d41c5a_a4a9827ed20011f1992e525400638852
    ReservedCode2: UPOfkS0/S7UiXujMMfzgidmlkKQQkWtnNcrYQbgrcXI4AUzXt/vpHMBOO8rTQJNpWIDHjUziuGYeYpX7uJ90Dt8N8ALbuy8TSUDwoQEkHPyBnlNorUA5/C6wYF3no/GoaV1kdrkniG8e7pwFsvqAXADeU3IGTLySgKbrNsV8RGvErmF9AAzj4O9mYHQ=
---

# notesync — 错题认知诊断引擎

> 本地 AI 驱动的错题诊断 Web 应用：学生上传错题（文字 / 图片 / PDF），AI 通过多轮追问定位知识薄弱点，生成个性化诊断报告与复习方案。数据默认保存在本机，支持完全离线的本地模型运行。

## 功能特性

- **多轮对话式诊断**：不是简单搜题给答案，而是通过 1~3 轮追问逐步收敛知识薄弱点，最终生成个性化复习方案
- **多种错题输入方式**：粘贴/输入文字、上传错题图片（拍照/截图）、上传 PDF 试卷/作业
- **OCR 文字识别**：图片错题本地 OCR（tesseract.js + 离线中文语言包），无需联网
- **PDF 文本解析**：pdfjs-dist 服务端提取 PDF 文本并注入诊断上下文
- **双模型 Provider 路由**：配置 DeepSeek API Key 时使用云端多模态模型；无 Key 时自动回退本地 ollama（默认 `qwen2.5:7b`）
- **知识库增强检索（RAG）**：内置数学知识点与错题案例种子库，混合检索（向量 + 关键词）为诊断提供依据
- **思考过程可视化**：AI 回复可展开「诊断过程」面板，查看工具调用与知识库检索记录
- **追问卡片**：需要补充信息时以卡片形式列出问题，一键「回答此问题」
- **多会话分支**：每个会话独立对话，localStorage 持久化，刷新不丢失
- **三套主题**：暗色 / 浅绿 / 浅蓝，一键切换并持久化

## 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | Next.js 16.4.3（App Router + Turbopack） |
| UI | React 19.3.0 + Tailwind CSS 4 |
| 语言 | TypeScript 5 |
| AI 推理 | DeepSeek 官方 API（可选）+ ollama 本地模型（`qwen2.5:7b`） |
| OCR | tesseract.js 7 + 离线语言包（chi_sim / eng） |
| PDF | pdfjs-dist 5 |
| 存储 | 浏览器 localStorage |

## 快速开始

### 环境要求

- Node.js 20+（建议 20 LTS 或更高）
- 满足以下任一推理后端：
  - 配置 DeepSeek API Key（推荐，支持图片多模态）；或
  - 本机安装并启动 [ollama](https://ollama.com)（默认端口 11434），且已拉取模型（默认 `qwen2.5:7b`）

### 安装与启动

```bash
# 1. 安装依赖
npm install

# 2. （可选）配置环境变量
# 复制模板并填写 DEEPSEEK_API_KEY
cp .env.example .env.local   # Windows: copy .env.example .env.local

# 3. 启动开发服务器
npm run dev
# 访问 http://localhost:3000

# 4. 生产构建与启动
npm run build
npm run start
```

### 首次使用（纯本地 ollama 模式）

```bash
# 拉取默认诊断模型
ollama pull qwen2.5:7b
# 确认 ollama 服务运行在 11434 端口
ollama serve
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 否 | DeepSeek 官方 API Key。配置后可在界面选择 DeepSeek 云端模型（`deepseek-flash` / `deepseek-v4-pro`），并支持上传真实图片进行多模态理解 |
| `DEEPSEEK_BASE_URL` | 否 | 自定义 DeepSeek API 地址（默认官方地址，一般无需设置） |

> 不配置 `DEEPSEEK_API_KEY` 时，系统自动回退到本地 ollama（`qwen2.5:7b`），仅支持文字与 OCR/PDF 提取后的文本诊断。
> 密钥仅保存在本地 `.env.local`，已加入 `.gitignore`，严禁提交到仓库。

## 额外运行时依赖（package.json 之外）

以下依赖不会通过 `npm install` 自动获取，但运行时必需：

| 依赖 | 说明 | 获取方式 |
| --- | --- | --- |
| OCR 语言包 `tessdata/` | `chi_sim.traineddata.gz`、`eng.traineddata.gz`，图片中文 OCR 识别必需 | 已随仓库分发（项目根目录 `tessdata/`），无需在线下载 |
| ollama 模型 | 默认 `qwen2.5:7b`（DeepSeek 未配置时的默认推理模型） | `ollama pull qwen2.5:7b` |
| DeepSeek API Key | 使用云端多模态模型时必需 | 在 [DeepSeek 开放平台](https://platform.deepseek.com) 申请，填入 `.env.local` |

## 目录结构

```
notesync/
├── app/
│   ├── page.tsx              # 首页引导页
│   ├── chat/page.tsx         # 主对话诊断页（SSE 流式渲染）
│   ├── diagnose/page.tsx     # 传统上传诊断页（简化版）
│   └── api/
│       ├── chat/route.ts     # 聊天 SSE 接口（PDF/OCR 注入 + harness 编排）
│       └── models/route.ts   # 模型列表聚合接口
├── components/               # 前端组件（ChatInput/ChatMessage/Sidebar/ThemeSwitcher）
├── lib/
│   ├── agent/                # Agent 决策循环（loop/tools/types）
│   ├── harness/              # 编排状态机（index/state/prompts/types）
│   ├── provider/             # 双 Provider 路由（deepseek/ollama）
│   ├── rag/                  # RAG 知识库（embedding/seed/store/types）
│   ├── ocr.ts                # tesseract.js OCR 封装
│   ├── pdf.ts                # pdfjs-dist PDF 解析
│   ├── storage.ts            # localStorage 会话持久化
│   ├── theme.ts              # 主题管理
│   └── types.ts              # 全局类型
├── tessdata/                 # OCR 离线语言包（chi_sim / eng）
├── .env.example              # 环境变量模板
├── TECHNICAL_DOC.md          # 详细技术文档
└── next.config.ts
```

## 演示截图

> 占位说明：请在提交前将实际运行截图放入 `docs/screenshots/` 目录并替换下方图片链接。

| 截图 | 说明 |
| --- | --- |
| ![首页](docs/screenshots/home.png) | 首页引导页 |
| ![对话诊断](docs/screenshots/chat.png) | 多轮对话诊断与追问卡片 |
| ![思考过程](docs/screenshots/thinking.png) | 诊断过程面板（工具调用 / RAG 检索） |

## 相关文档

- [TECHNICAL_DOC.md](./TECHNICAL_DOC.md)：系统架构、Agent 决策循环、RAG 知识库、双 Provider 路由、OCR/PDF 解析、前端交互设计、构建部署与评审要点对照

## 参赛与合规说明

- 本项目为 AI Web 大赛参赛作品，代码为原创
- API 密钥通过环境变量注入，不随仓库公开
- 提交材料要求（代码仓库、README、演示视频、技术文档 PDF、`.env.example`、Git 提交记录）详见 [TECHNICAL_DOC.md](./TECHNICAL_DOC.md)「评审要点对照」
*（内容由AI生成，仅供参考）*
