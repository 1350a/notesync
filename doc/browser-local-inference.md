# 浏览器端本地推理协议（browser-local-inference）

## 1. 定位与范围

本地能力底座（`feat/browser-ai-inference` 方向）的第二块拼图（第一块见
doc/browser-local-ocr.md）：**语义嵌入（embedding）与 RAG 检索完全在浏览器内完成**，
语料与查询向量均不经过服务器。服务端只负责分发静态模型资产，不参与推理。

继承自已确认的原则（与 OCR 协议 §1 同源）：

- **设备边界规则**：数据不出设备的降级可静默（如 WebGPU 探测失败静默回退 WASM）；
  一旦需要把数据送出设备（如云端 embedding），必须显式提示并获用户同意，不允许静默。
- **路由绝对权在使用者**：本地检索开关（`rag.enabled`）由用户显式打开，系统不默认开启。
- **v1 边界**：只做 embedding + RAG；小 LLM 闲聊生成、意图识别拦截属 v2（§8 挂账）。

## 2. 技术选型与底座契约

| 项 | 决定 | 理由 |
|---|---|---|
| 运行时 | Transformers.js v4（`@huggingface/transformers@4.3.2`）+ onnxruntime-web | embedding 与将来的小 LLM 共用一底座；依赖已预置于 package.json |
| 执行环境 | Web Worker（自建，加载自托管 pipeline） | 推理不阻塞主线程；与 OCR 的 worker 模式对齐 |
| 计算后端 | 自动：WebGPU 探测失败**静默回退** WASM | 后端切换不改变数据边界（都在设备内），静默合法（§1）；WebGPU 覆盖 ~84%，WASM 兜底 Firefox 非 Windows 与旧浏览器 |
| 模型 | `onnx-community/bge-small-zh-v1.5-ONNX` | 中文优化（512 维）、Transformers.js 官方支持（CLS pooling + normalize，无 query/passage 前缀）、体积小 |
| dtype | 按设备显式指定：webgpu → `q4f16`（29.3MB）/ wasm → `q8`（23.8MB） | v4 在 WebGPU 下默认 fp32 会多下载一倍，必须显式传 dtype 覆盖 |
| 检索算法 | 自写暴力余弦 + 关键词重合混合评分 | 几千条 chunk 规模暴力扫描个位数毫秒，ANN 索引无必要；零依赖规避 orama 中文分词不确定性 |

实测模型资产清单（2026-11-10 于 huggingface.co 实地核验，外置权重格式
`.onnx` 与 `.onnx_data` 成对）：

| 文件（仓库相对路径） | 体积 | 用途 |
|---|---|---|
| `config.json` | 904 B | 模型配置 |
| `tokenizer.json` | 363 kB | 分词器 |
| `tokenizer_config.json` | 414 B | 分词配置 |
| `onnx/model_quantized.onnx` + `_data` | 168 kB + 23.8 MB | q8（WASM 档） |
| `onnx/model_q4f16.onnx` + `_data` | 51.1 kB + 29.3 MB | q4f16（WebGPU 档） |

运行时按设备只加载其中一档（q8 或 q4f16），首次下载 24–30MB。

env 配置要点（依 v4 官方文档核实，2026-11-10）：浏览器下 `env.allowLocalModels`
**默认为 false**，必须显式置 `true`；`env.allowRemoteModels = false` 关闭一切远程
加载；`env.backends.onnx.wasm.wasmPaths = '/models/ort/'` 指向自托管 ORT wasm
（`env.useWasmCache` 默认 true，wasm 亦入 Cache API）。dtype 由引擎按探测结果
显式传单值（'q4f16' / 'q8'），不使用官方未文档化的 per-device 映射写法。

## 3. 资产分发（自托管，运行时零外联）

资产由 `npm run local:assets`（`scripts/copy-local-models.mjs`）下载到
`public/models/bge-small-zh-v1.5/`，**镜像 HF 仓库完整目录结构**（含 `onnx/`
子目录）。`public/models/` 为派生产物，不入库（`.gitignore` 忽略）。

约束：

- 下载源默认 `huggingface.co` 直连，`HF_MIRROR` 环境变量可切换
  （如 `https://hf-mirror.com`）；脚本按上表体积做完整性校验，缺文件即报错。
- 运行时不引用任何外部 CDN；Transformers.js 的 `env.remoteHost` 保持默认关闭，
  模型一律经 `from_pretrained('/models/bge-small-zh-v1.5', ...)` 从同源加载。
- 资产缺失属**可检测的未就绪状态**：调用方必须据此把能力标记为不可用并提示
  `npm run local:assets`，不得渲染假可用 UI（AGENTS.md §8）。

## 4. 服务契约（`lib/local/`）

```ts
// lib/local/assets.ts
type LocalAssetStatus = { ready: boolean; missing: string[] };
// 资产就绪探测：HEAD 全部运行时路径（两档权重 + tokenizer 全套）
checkLocalAssets(): Promise<LocalAssetStatus>

// lib/local/engine.ts
type LocalEngineStatus =
  | { state: 'idle' }                                  // 未初始化
  | { state: 'loading'; progress: number }             // 下载/编译中（0~1）
  | { state: 'ready'; device: 'webgpu' | 'wasm' }      // 可用
  | { state: 'error'; message: string };               // 不可用（含资产缺失）

// 引擎单例：惰性初始化，内部先探测 navigator.gpu，失败静默回退 wasm。
// 存储持久化：就绪时尝试 navigator.storage.persist()，防 Safari 7 天缓存驱逐。
initLocalEngine(onProgress?): Promise<LocalEngineStatus>
getLocalEngineStatus(): LocalEngineStatus
disposeLocalEngine(): Promise<void>

// lib/local/embedding.ts
// 批量嵌入 + L2 归一化（池化=cls、normalize=true）；须经 initLocalEngine 就绪
embedTexts(texts: string[]): Promise<Float32Array[]>
```

失败语义：

- **资产未就绪 / WebGPU 不可用回退 WASM / persist() 被拒** → 均为设备内事件，
  静默处理（§1）；`ready` 状态的 `device` 字段如实反映实际后端。
- **嵌入失败（模型损坏/内存不足）** → `embedTexts` 抛错，调用方跳过本次检索
  （聊天链路直接裸发，不阻断消息发送），不回落云端。

## 5. RAG 协议（`lib/local/rag/`）

### 5.1 语料（v1）

v1 语料 = **内置种子知识卡**（知识点/错题卡，改造自旧服务端 `lib/rag/seed.ts`，
类型对齐其 `KnowledgeChunk`：id/title/kind/subject/content/tags）。用户会话与
笔记的索引化属后续数据层工作（§8），协议届时在本节扩展。

### 5.2 切块与索引

- 种子卡天然成块（一卡一 chunk），`v1 不做长文切块`；`chunkText` 纯函数
  （按段落/标题切、单块上限）预留给笔记语料，含冒烟用例但暂无调用方。
- 向量 **Float32Array** 存 IndexedDB（库名 `notesync-local-rag`，store `chunks`：
  chunkId 主键 + 向量 + 元数据；store `meta`：embeddingModel 版本标记）。
- 换嵌入模型 → `meta` 版本（模型 ID）不匹配 → 全量重建索引（语料在本地，重建成本可控）；
  dtype 档差异属同模型向量空间的数值微漂移，不触发重建。
- 首次检索惰性构建：批量嵌入全部 chunk 后落库，之后增量。

### 5.3 检索（纯函数，可冒烟）

```
score = 0.65 × cosine(queryVec, chunkVec) + 0.35 × keywordScore(query, chunk)
```

- `keywordScore`：query 检索单元（中文 unigram+bigram，对齐旧 `tokenizeText`）
  在 chunk 文本的覆盖率——向量检索的中文兜底。
- 预算：`topK = 4`，`minScore = 0.05`；查询向量经同一引擎嵌入。
- `search.ts` 只含纯函数（`cosine` / `topK` / `chunkText` / 混合评分），
  不触碰 IndexedDB 与 Worker，`npm run smoke:rag` 直接可跑（AGENTS.md 脚本零依赖约定）。

## 6. 聊天链路接入（ragContexts 契约）

本地 RAG 的第一个业务接入：**发送前在浏览器内检索，命中片段随请求体提交**，
服务端校验后注入上下文。数据流向：语料与查询都不出设备，提交给云端模型的
只有检索命中的片段本身（与用户消息同等地位，无额外隐私面）。

### 6.1 客户端（`hooks/useChat.ts`）

发送前若 `rag.enabled === true` 且引擎就绪：嵌入 query → topK → 请求体附
`ragContexts`。引擎未就绪/嵌入失败 → **静默跳过**（消息照常裸发，设备内事件，§1）。

### 6.2 请求契约（/api/chat 请求体新增字段）

```ts
{ model, messages, ragContexts?: RagContext[] }
type RagContext = { title: string; snippet: string; score: number };
```

- 服务端校验：非空数组、≤4 条、`title` ≤200 字符、`snippet` ≤800 字符、
  `score` 为 0~1 有限数；非法整组丢弃（不影响消息发送），**不报错**。
- 注入格式（`lib/chat/messages.ts`，仅注入最后一条用户消息前）：

```
【本地检索】以下为浏览器本地知识库检索结果，供参考：
[1] {title}
{snippet}
[2] …
【/本地检索】
```

- `ragContexts` 为空/缺失 → 完全不注入，链路行为与现状一致。

## 7. 设置协议（user-settings.md 联动）

设置页新增「本地能力」分区（`SettingsSection` 扩展），按任务三行（路由绝对权在使用者）：

| 行 | 状态 | 内容 |
| --- | --- | --- |
| 图片处理（OCR） | **实装**（自通用设置迁入） | 自动 / 优先本地 OCR（写 `ocr.preferLocal`，语义见 browser-local-ocr.md §6） |
| 知识检索（RAG） | **实装** | 开关写 `rag.enabled`（默认 false）+ 引擎状态（未下载时展示 `npm run local:assets` 提示与下载进度）|
| 本地对话 | 占位 | v1 仅云端；本地选项禁用 + “未实装”标注（AGENTS.md §8） |

`UserSettings` 新增：

```ts
rag: { enabled: boolean };  // 【已接线】true=发送前浏览器本地检索并注入命中片段
```

normalize 规则：`rag.enabled` 严格 `=== true` 才为 true（与 `ocr.preferLocal` 同款从严布尔）。

## 8. 后续挂账（不属于本协议 v1）

- v2 小 LLM：Qwen3-0.6B 优先（新导出待核），Qwen2.5-0.5B-Instruct ONNX 备选
  （2026-11-10 实测：q4f16 483MB / q4 786MB / int8 512MB，单文件格式）；
  闲聊/FAQ 生成 + 非业务问询本地拦截。
- 云 OCR 两段管线（视觉模型转文字 → imageTexts → 纯文本模型）。
- 云端 embedding 选项、对话任务本地档位、模型镜像端点配置（`env.remoteHost`）。
- 用户会话/笔记语料索引化（待数据层协议明确后扩展 §5.1）。
- Safari 26 WebGPU EP 内存问题跟踪（onnxruntime #26827）——影响 q4f16 档在
  Safari 的可用性，届时或对 Safari 强制 q8/wasm。
- CSP 响应头（本分支落地基础版：self + `worker-src 'self' blob:`）。
