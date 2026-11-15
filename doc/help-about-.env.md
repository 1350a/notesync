# .env.example文件介绍

## 此项目的 `.env` 不是常规的配置中心

`.env` 是文件，作用是把值注入进程环境变量，注意所有变量进程启动时读一次，改完必须重启。

## 如何使用？

根目录下默认包含了一个 `.env.example` 配置模板文件，直接把它重命名为 `.env` 即可。

> 此项目的 Next.js 对于同名变量，会优先认 **`.env.local` ,因此你也可以命名为 `.env.local`

重命名之前你也可以创建一个副本作为备份。

---

**对于 Windows 用户**，请遵循如下步骤：

1. 右键 `.env.example` 文件并点击「重命名」；
2. 在输入框中将该文件重命名为 `.env.`（**注意**，最后有一个点符号 `.`）；
3. 按下回车确认，文件名最后的 `.` 将会自动消失；
4. 你已完成重命名操作（是的，Windows 就是这么神秘）。

当然您也可以在 PowerShell 中执行 `Rename-Item .env.example .env` 或在 CMD 中执行 `copy .env.example .env`。

---

Linux 或 macOS 用户直接 `cp .env.example .env` 就好了。

## 配置文件字段详解

以下内容是每个选项的详细说明。

对于普通用户，项目提供了DeepSeek和智谱两家云端厂商，外加自定义 OpenAI 兼容端点，你可以在对应模型厂商申请API Key并将其填入即可使用。

> 简而言之，DeepSeek的性价比高，智谱会送免费额度，且提供一个免费调用的模型 `glm-4.7-flash`

### 模型配置选项

#### `DEEPSEEK_API_KEY` / `ZHIPU_API_KEY` / `CUSTOM_API_KEY`

请务必保管好自己的 API Key，这是敏感数据。
这些选项若留空，则会被认定未配置该厂商模型。另外，如果你确认配置的自定义模型没有鉴权，那可以随便填，比如 `ollama`

> **特别说明**：如果没有配置智谱，则云端OCR模型 `glm-ocr` 会报错。

#### `DEEPSEEK_BASE_URL` / `ZHIPU_BASE_URL` / `CUSTOM_BASE_URL`

对于前两个通常不用管，除非模型提供商改变了URL。
注意如果要配置自定义模型，则 `CUSTOM_BASE_URL` 为必填，注意本项目仅支持 OpenAI API 协议（ OpenAI Chat Completion ）。

#### `DEEPSEEK_MODEL` / `ZHIPU_MODEL` / `CUSTOM_MODEL`

通常留空即可。
添加自定义模型时，请自行确认自定义的模型提供商提供的模型名。项目支持 `GET /models` 的端点，但若不支持会导致配置失败。

#### `DEEPSEEK_SAFETY_CHECK`（这一部分在13号DeepSeek更新后加入）

DeepSeek 服务端内容安全审核（仅对 DeepSeek 生效）。填 `high` 开启：平台会审核请求的输入与输出，命中风险时拒答（输入未过审直接报 400，已生成的回答被丢弃并展示拦截说明）。`low` / `off` / 注释掉该行 = 不发送，行为与开启前完全一致——官方口径 `low` 即 API 默认内容检查，与不传 `safety_check` 相同，故同样不发送。

注意两点：审核口径由 DeepSeek 决定，个别正常题目可能被误拒；开启后审核产生的 token 计入输出计费。对外提供服务时建议开启（合规要求），纯个人使用可自行取舍。

### 工具配置

- `TOOLS_ENABLED` 启用工具，不建议改为 `false`
- `TOOL_MAX_ROUNDS` 工具调用最大次数，防止一直调用
- `CUSTOM_TOOL_MODE` 默认native，如果你配置的小模型无法调用工具，可以尝试改为text，仅对自定义模型生效
- `CUSTOM_ALLOW_IMAGES` 如果你确认自定义配置的模型是多模态，请务必将其改为 `1` ，否则无法直接向其发送图片

### 上下文与请求透传

- `TRIM_BUDGET_CHARS` 会话过长时保留多少字的最近上下文（字符数），默认 `24000` 。 `0` 表示不裁剪。
- `USER_FIELD_ENABLED` 标识用户id的，不想用可以改为 `0`

### 本地资产

- `HF_MIRROR`

该配置只影响 `npm run local:assets` 这条下载命令的来源。
执行 `npm run local:assets` 失败时，可尝试将其改为镜像地址（如 https://hf-mirror.com）

### 调试开关

以下开关都只有填 `1` 才生效
**注意**： `MOCK_MODEL` 为 `0` 时，只有 `MOCK_IMAGE_MODE` 会失效，剩下的**仍然有效**

- `MOCK_MODEL`

功能说明：启用后，对话接口和试卷诊断接口不再调用任何模型，直接把“实际会发出去的数据”原样回显——附件如何降级、注入了哪些系统提示词、诊断状态机的上下文等。适合“零token检查”发送内容是否正确

- `MOCK_IMAGE_MODE` 填 `text-only` 强制按“模型不支持图片”的链路回显；留空则按所选模型的能力自动决定。
- `MOCK_OCR` 云端 OCR 接口直接返回占位文本，不校验密钥、不调用智谱。
- `MOCK_PARSE_DOC` 文档解析接口直接返回占位文本，不实际解析 docx/pptx。
- `MOCK_TTS` 朗读接口不调用上游、不校验密钥；清洗与分段照常执行，每段音频为固定短静音占位（doc/tts.md §6），适合零成本验证"清洗 → 分段 → 队列播放"全链。
