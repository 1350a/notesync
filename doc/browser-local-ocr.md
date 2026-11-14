---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 0389a83fdf2fd477e56fb14bde9a8feb_e6c5d658dd0d11f1bc42525400638852
    ReservedCode1: LYJ/CCIp39UdI5ywTJgWJwugo3L5YMVLyQJjwhO8yfcptbU9BdmEPGr4LW8xwMV7ZKs+AQEN3qS+9jbwEqXbeoxi4In53RkQjflirT+A223GhO1XOJIdG/tyhADZeAadFp9H5/FcWLTN+PODRz8LXyaBVMr7rjXY4K2np5a+U+TTDtJl6wodSp2fCtg=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 0389a83fdf2fd477e56fb14bde9a8feb_e6c5d658dd0d11f1bc42525400638852
    ReservedCode2: LYJ/CCIp39UdI5ywTJgWJwugo3L5YMVLyQJjwhO8yfcptbU9BdmEPGr4LW8xwMV7ZKs+AQEN3qS+9jbwEqXbeoxi4In53RkQjflirT+A223GhO1XOJIdG/tyhADZeAadFp9H5/FcWLTN+PODRz8LXyaBVMr7rjXY4K2np5a+U+TTDtJl6wodSp2fCtg=
---

# 浏览器端本地 OCR 协议（browser-local-ocr）

## 1. 定位与范围

本地能力底座（当前分支 `beta/browser-ocr-planb`；该方向早期命名为
`feat/browser-ai-inference`，二者指同一条线）的第一块拼图：**OCR 完全在浏览器内完成，
图片与识别文本均不经过服务器**。服务端只负责分发静态资产（模型/词库/wasm 文件），
不参与推理、不接收图片。

对应的已确认原则：

- **本地 OCR 必做**：离线可用、隐私默认路径；云 OCR 属于后续用户显式选择的可选能力。
- **设备边界规则**：数据不出设备的降级可静默；一旦需要把数据送出设备（如回落云 OCR），
  必须显式提示并获用户同意，不允许静默。
- **路由绝对权在使用者**：本能力不自动替用户切换到云端。

第二块拼图（浏览器端 embedding + RAG）见 doc/browser-local-inference.md；
本协议的设备边界规则与自托管资产模式由其继承。

## 2. 技术选型

| 项 | 决定 | 理由 |
|---|---|---|
| 引擎 | tesseract.js v7（LSTM，oem=1） | 成熟、纯 wasm、自带 worker 封装；中文质量对干净版面够用 |
| 推理环境 | 浏览器 Web Worker（tesseract.js 内建） | 不阻塞主线程；wasm SIMD 由引擎按设备自选 |
| 语言包 | 仅 `chi_sim` | tesseract.js v7 在自定义 langPath 下多语言存在加载乱码 bug（服务端时代已踩坑，见 lib/ocr.ts 注释） |
| WebGPU | 不适用 | tesseract 为 wasm 路径；WebGPU 属于 embedding/小模型层（RAG），与本协议无关 |

落选说明：onnxruntime-web + PaddleOCR 中文识别质量更好，但模型管线（det/cls/rec 前后处理）
集成与调试成本高。本 beta 先落地 tesseract，`lib/ocr/` 服务接口保持引擎无关，
后续替换引擎时页面与调用方不变。

## 3. 资产分发（自托管，运行时零外联）

资产由 `npm run ocr:assets`（`scripts/copy-ocr-assets.mjs`）从本地来源复制到
`public/ocr/`，**全部来源在仓库或 npm 依赖内，脚本可离线重复执行**。
`public/ocr/` 为派生产物，不入库（`.gitignore` 忽略）。

| 运行时路径 | 来源 | 用途 |
|---|---|---|
| `/ocr/worker/worker.min.js` | `node_modules/tesseract.js/dist/worker.min.js` | 引擎 worker 脚本 |
| `/ocr/core/tesseract-core-*.wasm.js` | `node_modules/tesseract.js-core/*.wasm.js`（全 6 变体） | 推理核心，worker 按设备 SIMD 特性自选其一 |
| `/ocr/tessdata/chi_sim.traineddata.gz` | 仓库根 `tessdata/`（原服务端 OCR 语言包，复用） | 语言包 |

约束：

- 运行时不引用任何 CDN；`next.config.ts` 的 `serverExternalPackages` 仅服务旧服务端
  实现，与本协议无关。
- 资产缺失属**可检测的未就绪状态**：调用方必须据此把能力标记为不可用并提示
  `npm run ocr:assets`，不得渲染假可用 UI（AGENTS.md §8）。

代码侧核对（2026-11-10，按当前实现实查）：

- `checkOcrAssets()` 当前**唯一调用方是 `/ocr` 自检面板**
  （`app/(main)/ocr/_components/ocr-test-panel.tsx`，`HEAD` + `no-store` 逐项探测并逐条报 FAIL）。
- 聊天/诊断链路**不做 OCR 资产前置门禁**：`ocr.preferLocal` 开关位于「通用设置」的
  「图片处理」行（`components/settings/GeneralSection.tsx`），**不迁入**「本地能力」分区
  （口径见 `browser-local-inference.md` §7：OCR 是独立能力域，开关只在一处出现），
  资产缺失时不会在开关处禁用，而是在识别阶段失败 → 按 §6.4
  阻断发送、逐张列明原因并提示 `npm run ocr:assets`。这是有意取舍：OCR 资产体积小、
  失败原因可判读，不重复做前置探测。
- `next.config.ts` 的 `serverExternalPackages: ["tesseract.js"]` 确实只服务旧服务端
  实现，浏览器侧走自托管 worker/core，不受其影响。

## 4. 服务契约（`lib/ocr/local.ts`）

```ts
type OcrAssetStatus = { ready: boolean; missing: string[] };

// 资产就绪探测：HEAD 全部运行时路径，页面加载时调用一次
checkOcrAssets(): Promise<OcrAssetStatus>

// 识别入口：source 为 Blob/File/图片 dataUrl；onProgress 可选
// 返回原文（未清洗）+ 置信度 + 耗时
ocrRecognize(source: Blob | string, onProgress?): Promise<OcrResult>

// 比对/展示用规范化：去空白、全角转半角、小写化
normalizeOcrText(text: string): string

// 释放 worker（页面卸载或显式释放内存时调用）
disposeOcrWorker(): Promise<void>
```

失败语义：

- **资源未就绪** → `checkOcrAssets` 返回 `ready: false`，调用方进入不可用态，不发起识别。
- **识别失败/超时** → `ocrRecognize` 抛错或返回错误状态，由调用方决定提示；
  **不得静默回落云端**（设备边界规则）。
- worker 单例惰性初始化，单 worker 串行识别；当前场景（能力页自检 + 低频识别）足够。

## 5. 能力页与验收口径

`app/(main)/ocr`：本地 OCR 能力页（URL 仍为 `/ocr`，布局由 `app/(main)/layout.tsx` 承载）。

1. **内置自检**：页面用 canvas 渲染已知中文文本（刻意不含标点与数字，规避 OCR 对
   标点/数字的歧义噪声）生成 PNG → 调用 `ocrRecognize` → 与期望文本做规范化比对，
   页面展示 PASS/FAIL。
2. **自定义图片**：用户选择本机图片识别，展示识别文本、置信度、耗时。

验收标准：**浏览器实际操作**下，自检的规范化比对为 PASS，即识别结果符合代码预期。

## 6. 聊天/诊断链路接入（imageTexts 契约）

本地 OCR 的第一个业务接入：**图片先在浏览器内转成文字，再随消息发送**，纯文本模型
（本地 deepseek-local、DeepSeek 的 `deepseek-v4-pro` 等文本款）因此可以"看到"图片内容而不报错。

### 6.1 图片发送模式与派生规则（2026-11-14 重写：自动路由，无人工档位）

```
ImageSendMode = 'direct'（原图直传，无转写） | 'ocr-text'（OCR 转文字，引擎由 ocr.engine 决定）
```

派生规则（`lib/ocr/image-handling.ts` 的 resolveImageSendMode，只看模型能力）：

1. 模型 `acceptsImages === true` → `direct`：多模态模型直传原图，**不做任何转写**。
2. `false` / `undefined` / 无模型 → `ocr-text`（能力未知保守转文字，绝不赌上游）。

- 旧 `ocr.preferLocal`（"优先本地OCR"一律转文字）**已删除**；当次切换（三档选择器）
  **已下线**——路由全自动，输入区只展示派生结果与代价文案，不提供模式控件
  （product-vision.md P4，2026-11-14 拍板）。
- 持久偏好只剩 `ocr.engine` 一处（local/cloud，默认 cloud，doc/cloud-ocr.md §4）。
- 旧档位名 `local-ocr` 更名 `ocr-text`：原名称在云端引擎下成了谎言（转写不再"local"）。

### 6.2 请求契约（/api/chat messages 元素）

```ts
{ role, content, images?: string[], imageTexts?: string[], files? }
```

- `images`：直传模式的图片 dataUrl（原语义不变）。
- `imageTexts`：OCR 模式产物，与该消息图片一一对应的识别文本（仅非空文本）。
  **服务端组装规则按「是否同时携带 images」区分**：
  - 仅 `imageTexts`（ocr-text 档）：忽略 images 本体，按
    `【图片 N OCR】…【/图片 OCR】` 文本块（`formatOcrBlock`）拼进正文，
    任何模型都可安全消费；此类消息不占用 MAX_IMAGE_MESSAGES 图片配额。
  - `imageTexts` + `images` 同时存在（**混合档，2026-11-14 起客户端不再产出，仅为旧
    持久化会话的重发保留兼容**）：OCR 文本块打底 + 原图 image_url 补充，一并组装；
    此类消息**占用**图片保留配额，且仅当所选模型支持多模态才按混合组装，否则降级为
    纯 OCR 文本（与直传降级同口径）。
- 直传路径完全不变；**整卷诊断附件的混合形态**（`text` 与 `dataUrl` 同时存在）同上：
  服务端 `resolveAssembleImageMode` 保留该判定分支只为兼容，新客户端不再产出
  混合形态附件（详见 `diagnose-file-intake.md` §6.1）。
- 两档（多模态 / OCR 转文字）的呈现约束见 `product-vision.md` P4：
  路由全自动、不提供档位控件，外发代价写在发送处。
- 气泡徽章（`ChatList`）按消息记录的 `ocrEngine`（`ChatMsg` 可选字段，发送时写入，
  历史回读经 sanitize 白名单放行）显示「云端转文字 / 本地转文字」；无字段的旧消息
  显示中性「OCR转文字」，不写死引擎（2026-11-14 起，导出 Markdown 同口径）。

### 6.3 Provider 能力默认值（本轮修正）

| Provider | 口径 | 理由 |
|---|---|---|
| custom（OpenAI 兼容端点） | `CUSTOM_ALLOW_IMAGES=1` 才直传，默认纯文本 | 端点多为本地 Ollama/vLLM 纯文本模型，默认直传必 400；真多模态端点显式开启 |
| deepseek | 按模型名：名字含 `flash` 或 `vision` 才直传，`deepseek-v4-pro` 等为纯文本 | 官方 Vision 仅支持 `deepseek-flash`，`deepseek-v4-pro` 直传必 400 |
| zhipu | 维持既有按目录判定 | 已实现 modelAcceptsImages |

### 6.4 失败语义

- OCR 失败/空结果的图片**阻断发送**并逐张列明原因，由用户决策（移除该图/在设置中
  切换识别引擎后重试）；绝不静默丢弃图片内容，也绝不静默改为直传或换引擎。
- （旧混合档"OCR 失败不阻断、仅提示该图只传原图"的分支随混合档下线一并取消——
  现在转写只发生在纯文本模型路径，识别文本是唯一通道，失败必须阻断。）
- 识别进度在输入区可见（wiring honesty）；本地引擎下数据全程不出设备。

## 7. 后续挂账（不属于本协议）

- 接入 diagnose 图片诊断链路（替代已停用的服务端 `lib/ocr.ts`）。
- ~~云 OCR 选项（用户显式选择，走设备边界规则提示）~~ **已实装（2026-11-12）**：
  转写引擎维度落地为 `ocr.engine`，智谱 glm-ocr 经 `/api/ocr` 代理接入，
  独立协议见 doc/cloud-ocr.md（本文件保持"本地引擎"口径不变）。
- 设置粒度：OCR 引擎选择已归入「本地能力」分区（doc/browser-local-inference.md §7），
  2026-11-14 起「图片处理（OCR）」一行即引擎选择（本地/云端，默认云端），`preferLocal`
  档位偏好已删。
