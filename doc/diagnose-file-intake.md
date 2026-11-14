# 诊断模式 · 文件接入契约

> 状态：P1（detect / extract / assemble / send 四段已接通）｜最后更新：2026-11-14
> 对应代码：`lib/diagnose/`（types / detect / assemble / extract）、
> `lib/intake/`（两入口共用的判定与提取，见 doc/file-intake.md）、
> `app/diagnose/_components/UploadArea.tsx`、`app/api/chat/route.ts`（attachments 分支）

本文件定义"用户上传错题文件 → 组装成模型消息 → 发出请求"这一段的数据契约。
按 `AGENTS.md` §9，改这里先于改代码。

> **口径边界**：本文件只定义**上传与组装**，不定义「一道题够不够诊断」。
> 完整度判定口径以 `diagnosis-model.md` §1 为准（结论：**只认「有原题」为必需项**，作答有无决定走 L2 还是 L1，
> 正确答案 / 标准解析纯属增强）。实装在 `lib/diagnose/completeness.ts`，两处不得各写一套判据。

## 1. 范围

四段链路，本文件只覆盖这四段：

| 段 | 位置 | 职责 |
|---|---|---|
| detect | `lib/diagnose/detect.ts` | 判定文件种类，给出能否接收与拒收原因 |
| extract | `lib/diagnose/extract.ts` | 浏览器侧取出内容（图片 dataUrl / PDF 文字 / 纯文本） |
| assemble | `lib/diagnose/assemble.ts` | 纯函数，产出单条 `user` 消息 |
| send | `app/api/chat/route.ts` | 校验 attachments、调用 assemble、并入 messages |

不包含：模型返回内容的解析与展示口径、错题诊断的 prompt 工程、知识库检索。

## 2. 四类标签

| id | 中文 | 组装锚点 |
|---|---|---|
| `origin` | 错题原题 | `【错题原题】` |
| `wrong` | 错误答案 | `【我的错误答案】` |
| `correct` | 正确答案 | `【正确答案】` |
| `analysis` | 标准解析 | `【标准解析】` |

组装顺序固定为 origin → wrong → correct → analysis，与上传顺序无关。
每个非空分组先写一行锚点（含该组文件数），再挂该组文件内容。

## 3. 判定规则（detect）

2026-11-14 起 detect 委派 `lib/intake/detect.ts`（魔数判定规则、编码与图片契约
统一见 doc/file-intake.md §3~§6），本表只保留 DiagnoseKind 映射：

| 输入（魔数 / 扩展名） | kind | 是否接收 |
|---|---|---|
| 图片魔数（png/jpg/webp/bmp/avif/ico；heic 走三级阶梯） | `image` | 是；gif 魔数拒收（"动图请截帧后上传"） |
| pdf | `pdf` | 是 |
| 文本白名单（txt / md / markdown / csv 等） | `text` | 是 |
| docx | `doc` | 是，客户端 mammoth 解析 |
| doc | `doc` | 是，服务端 `/api/parse-doc` 解析（内容上传至自有服务端，UI 明示） |
| pptx | `office`（DiagnoseKind 新增值，仅 extract 分发用） | 是，客户端解析 |
| xlsx / xls | `unsupported` | 否，提示另存为 CSV 后上传（2026-11-14 暂缓，file-intake.md §10） |
| ppt | `unsupported` | 否，提示另存为 pptx |
| wps | `unsupported` | 否，提示另存为 docx |
| 其它 | `unsupported` | 否 |

拒收必须回具体原因（含文件名），不得用"暂不支持"泛化。

## 4. 提取规则（extract）

- **图片**：走 `lib/intake/extract-image.ts`（heic 三级阶梯、格式规范化、尺寸缩放，
  file-intake.md §5/§6），产出规范化后的 `data:image/png|jpeg` dataUrl。
- **PDF**：前端 `pdfjs-dist` 逐页取文字层，worker 走本地 `/pdfjs/pdf.worker.min.mjs`（不依赖 CDN）。
  上限 80 页 / 20000 字符；无文字层（扫描件）视为失败并给出原因。
  不把 PDF 转 base64 直传：多模态端点普遍不收 PDF，纯文本模型更看不到图。
- **纯文本**：走 `lib/intake/decode-text.ts` 编码探测（BOM → 严格 UTF-8 → GB18030 兜底，
  file-intake.md §4），空内容判失败。
- **Office（docx/pptx/xlsx/xls）**：走 `lib/intake/extract-office.ts` 客户端解析，
  上限 20000 字符（对齐 PDF）；`.doc` 走 `POST /api/parse-doc`。
- 单文件失败不抛错，降级为空内容 + `warning`，整批继续。

## 5. 请求体（`POST /api/chat`）

在既有 `{ model, messages | content }` 基础上新增可选字段：

```ts
interface ChatRequest {
  model?: string;
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  content?: string;
  /** 诊断附件；缺省或空数组时行为与本字段引入前完全一致 */
  attachments?: DiagnoseAttachment[];
}

interface DiagnoseAttachment {
  name: string;                              // 文件名，用于告警文案
  category: 'origin' | 'wrong' | 'correct' | 'analysis';
  dataUrl?: string;                          // 图片，data:image/...;base64
  text?: string;                             // PDF / 纯文本提取结果
  warning?: string;                          // 提取阶段降级原因
}
```

服务端校验：

- `attachments` 非数组 → 视作空数组。
- 单项缺 `name`、`category` 不在四类内 → 丢弃该项（`console.warn`），不影响其它项。
- `dataUrl` 不以 `data:image/` 开头 → 丢弃该字段（若同时带 `text` 则保留 `text`）。
- `dataUrl` 长度 > 12MB → 丢弃该项，防止请求体撑爆内存。
- 既无 `dataUrl` 也无 `text` → 丢弃该项。

## 6. 组装产物（assemble）

产出一条 `role: "user"` 消息，`content` 为 part 数组：

- 文本 part：`{ type: 'text', text }`
- 图片 part：`{ type: 'image_url', image_url: { url } }`

预算与上限：

| 项 | 默认 | 说明 |
|---|---|---|
| 文本总预算 | 8000 字符 | 按参与文本投喂的文件数均分 |
| 单文件下限 | 200 字符 | 均分后不足则抬到该值 |
| 图片上限 | 4 张 | 超出部分降级为文字占位，并计入 warning |
| 图片降级模式 | `multimodal` | 所选模型不支持图片输入时整体降为 `text-only`。判定优先走 Provider 的 `modelAcceptsImages(model)`（同 Provider 下模型能力可能不同，如智谱按 `ZHIPU_CATALOG` 目录标注）；Provider 未实现该方法时回落 Provider 级 `acceptsImages` |

### 6.1 图片投喂口径（2026-11-14 重写：两档自动路由，混合档下线）

| 档位 | 判定条件 | 组装行为 | 外发内容 |
|---|---|---|---|
| `multimodal` 直传 | 模型支持图片，附件只带 `dataUrl` | 按四类标签分组直发 `image_url`，超 4 张降级为文字占位 | 原图 |
| `mixed` 混合（**仅兼容**） | 模型支持图片，且任一项**同时**带 `dataUrl` 与 `text` | 先发 `[文件 X · 本地OCR]` 文本块打底，再发原图 | 原图 + OCR 文本 |
| `text-only` 降级 | 模型不支持图片输入 | 带 OCR 文本的项发文本块，无文本的项发文字占位；均不占图片配额 | 仅文本 |

判定统一由 `lib/diagnose/assemble.ts` 的 `resolveAssembleImageMode(attachments, allowImages)`
完成，**客户端不传档位字段**。2026-11-14 起客户端只产出两种形态（product-vision.md P4
按模型能力自动路由）：模型收图 → 附件只带 `dataUrl`（`multimodal`）；模型不收图 →
OCR 转写后只带 `text`（`text-only`）。`mixed` 判定分支保留只为兼容旧数据，不再是
UI 可达路径。`/api/chat`（单题）与 `/api/diagnose-paper`（整卷）共用该函数，
避免两条链路档位口径漂移。

失败降级：`text-only` 路径 OCR 失败则**阻断提交**（识别文本是唯一通道，由用户决策——
移除文件或在设置中切换识别引擎重试）。

聊天历史消息里的图片走同一能力口径：选中模型不支持图片时，历史消息的 `image_url` part
同样降级为文字占位并留一行说明（`buildProviderMessages` 的 `allowImages` 选项），
不会原样直传导致上游 400。

截断与降级都要留痕（写入 `warnings`），不得静默丢弃。

## 7. SSE 错误码扩展

新增 `no_content`：attachments 全部提取失败，没有可发送内容。

| code | 含义 |
|---|---|
| `no_model` | 未配置任何可用模型 |
| `invalid_request` | 请求体不是合法 JSON 或结构不符（两个路由共用，路由层就地拦截，不进入任何流程） |
| `invalid_model` | 模型名不属于任何已配置 Provider |
| `unconfigured` | 归属 Provider 的 KEY / BASE_URL 缺失 |
| `no_content` | 附件全部无效，无可发送内容 |
| `provider_error` | 上游返回错误 |
| `parse_error` | 工具调用解析兜底失败（doc/tool-protocol.md §5.3） |
| `content_blocked` | 上游安全策略拒绝（输入或生成中）。**不可重试**（重试只会再被拦一次）；UI 展示拦截说明，不展示已流出片段；被拒内容不进入下一轮历史（safety-protocol.md §2/§3.1） |

## 8. 调试开关（MOCK）

`MOCK_MODEL=1` 时 `/api/chat` 不解析模型、不碰任何上游，直接把组装结果渲染成摘要
（part 数、图片数、字符数、逐 part 预览、warnings）以 `content` 事件返回，
随后发 `done`（`model/provider` 均为 `mock`）。

用于零 token 验证"发送的数据是否正常"。`MOCK_IMAGE_MODE=text-only` 可复现纯文本模型的降级路径。

## 9. 已知未做

- `.doc` / `.docx` / pptx / xlsx / xls 解析已于 2026-11-14 接入（doc/file-intake.md）；
  `.ppt` 仍拒收（纯 JS 无解，智谱文件解析 API 待验证，file-intake.md §10 挂账）。
- 扫描件 PDF 的 OCR（旧 `lib/ocr.ts` 已停用，未接入本链路；图片的云端转写引擎已由
  doc/cloud-ocr.md 接入，PDF 接入 glm-ocr 仍为单独挂账）。
- 多模态能力按模型标注：智谱以 `ZHIPU_CATALOG` 元数据目录为唯一事实来源
  （vision / free 字段），DeepSeek / Custom 仍为 Provider 级 `acceptsImages`；
  未做逐模型的在线能力探测。智谱的 `/models` 枚举端点仅用于健康判定
  （其清单不含免费款，不能作为展示来源）。
- 前端未做图片缩略图预览（只显示文件名与状态）。
