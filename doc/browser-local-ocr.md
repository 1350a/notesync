# 浏览器端本地 OCR 协议（browser-local-ocr）

## 1. 定位与范围

本地能力底座（`feat/browser-ai-inference` 方向）的第一块拼图：**OCR 完全在浏览器内完成，
图片与识别文本均不经过服务器**。服务端只负责分发静态资产（模型/词库/wasm 文件），
不参与推理、不接收图片。

对应的已确认原则：

- **本地 OCR 必做**：离线可用、隐私默认路径；云 OCR 属于后续用户显式选择的可选能力。
- **设备边界规则**：数据不出设备的降级可静默；一旦需要把数据送出设备（如回落云 OCR），
  必须显式提示并获用户同意，不允许静默。
- **路由绝对权在使用者**：本能力不自动替用户切换到云端。

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

`app/ocr`：本地 OCR 能力页。

1. **内置自检**：页面用 canvas 渲染已知中文文本（刻意不含标点与数字，规避 OCR 对
   标点/数字的歧义噪声）生成 PNG → 调用 `ocrRecognize` → 与期望文本做规范化比对，
   页面展示 PASS/FAIL。
2. **自定义图片**：用户选择本机图片识别，展示识别文本、置信度、耗时。

验收标准：**浏览器实际操作**下，自检的规范化比对为 PASS，即识别结果符合代码预期。

## 6. 后续挂账（不属于本协议）

- 接入 diagnose 图片诊断链路（替代已停用的服务端 `lib/ocr.ts`）。
- 云 OCR 选项（用户显式选择，走设备边界规则提示）。
- 设置粒度：OCR 走本地/云端的偏好档位归属用户设置协议（user-settings.md）。
