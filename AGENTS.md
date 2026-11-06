<!-- markdownlint-disable MD041 -->
<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 项目规范

- 模型三选一（用户必须自行配置，代码不检测本地 ollama、不自动回退）：DeepSeek（`deepseek-v4-flash`，`https://api.deepseek.com`）、智谱（`glm-5.3`，`https://open.bigmodel.cn/api/paas/v4`）、自定义（仅支持 OpenAI API 规范的任意端点，如需本地模型可将端点指向 Ollama 的 `/v1`）；key/base_url/model 全走环境变量（`.env.local`，已被 .gitignore 排除）
- harness 协议：`/api/chat` 返回结构化响应——`phase=question` 时带 `questions` 追问列表（模型判断信息不足时主动向用户提问），`phase=answer` 时带 `content` 诊断内容；前端按 phase 渲染追问卡片并引导用户回答
- provider 分层：模型调用在 `lib/provider/`（统一 LLMProvider 接口 + `openaiCompat` 公共基类 + deepseek/zhipu/custom 三个实现），harness 编排在 `lib/harness/`；路由层只做薄转发
- 图片：仅本轮新消息以 `image_url` 多模态上传，历史消息图片保留文本标注；单图 dataUrl >12MB 降级为文本标注；DeepSeek 请求体上限 48MiB
- git：每写/改一个文件单独 `git add` + `git commit`（需单命令执行，一行多命令时 commit 会静默失效）；功能开发开新分支；commit message 说明文件用途
- 构建：改代码后先 `npm run build` 通过再提交
