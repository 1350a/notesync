---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 0389a83fdf2fd477e56fb14bde9a8feb_e615ca59dd0d11f1bc42525400638852
    ReservedCode1: +D1aqrfwAAzp0JgzDa1oN/yaTGesN1Mj8pAb2/1X0uVJzza3QQFoCS8RX2jWLGG2EBr7BeWXDhumO0276l0drqBBtaLhZUfyqU/V1zLWVN0KhOR+ow2Aj/f/62/SWfkDHZb0CgD4aN2y9uGr4Fppi+fl13nrWVoZXIIoeNwZmVDWdXOE92mYNsrmo2c=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 0389a83fdf2fd477e56fb14bde9a8feb_e615ca59dd0d11f1bc42525400638852
    ReservedCode2: +D1aqrfwAAzp0JgzDa1oN/yaTGesN1Mj8pAb2/1X0uVJzza3QQFoCS8RX2jWLGG2EBr7BeWXDhumO0276l0drqBBtaLhZUfyqU/V1zLWVN0KhOR+ow2Aj/f/62/SWfkDHZb0CgD4aN2y9uGr4Fppi+fl13nrWVoZXIIoeNwZmVDWdXOE92mYNsrmo2c=
---

# 浏览器端本地推理协议（browser-local-inference）

## 1. 定位与范围

本地能力底座（当前分支 `beta/browser-ocr-planb`；该方向早期命名为
`feat/browser-ai-inference`，二者指同一条线）的第二块拼图（第一块见
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
（`env.useWasmCache` 默认 true，wasm 亦入 Cache API）；`env.remoteHost` 库默认是
`https://huggingface.co/`，代码**显式置空**（`env.remoteHost = ''`）作为双保险——
即便某条路径绕过 `allowRemoteModels`，也拼不出可用的远程 URL。dtype 由引擎按探测结果
显式传单值（'q4f16' / 'q8'），不使用官方未文档化的 per-device 映射写法。

ORT 版本口径（2026-11-10 依官方包声明核实）：`@huggingface/transformers@4.3.2`
在其 `dependencies` 中**精确锁定**（非语义化范围）
`onnxruntime-web@1.31.0-dev.20260914-8d85527a0`，这是库作者声明的运行时版本——
官方文档源码（guides/tutorials）未提供 ORT 版本控制与 wasm 自托管路径的章节，
唯一可依的约束即该精确依赖。故本项目 `package.json` 声明同一版本，并用
`overrides` 把 `onnxruntime-web` 与 `onnxruntime-common` 收敛为全树唯一副本：
消除「根依赖一份 + transformers 嵌套一份」的双 runtime，保证 glue（`ort*.mjs`）
与 wasm 同包同版本。

实测记录（2026-11-10，Chrome 153 + AMD RDNA3，站点未配 COOP/COEP）：

- WASM 路径实测通过：点「预加载引擎」后状态为「已就绪 · WASM」，随后开启知识
  检索发一条消息，`/api/chat` 请求体带 4 条 `ragContexts` 且 score 连续
  （0.3457 / 0.3218 / 0.2841 / 0.2549），说明 q8 档嵌入真实产出向量并完成排序；
- WebGPU 路径本机未触发：`navigator.gpu.requestAdapter()` 能返回适配器，但
  `adapter.features.has('shader-f16')` 为 false，引擎按上文设备探测策略回退
  WASM（q4f16 档依赖 f16 着色器）。要在 WebGPU 分支上取证，需在暴露
  `shader-f16` 的设备打开「设置 → 本地能力 → 预加载引擎」，状态应显示
  「已就绪 · WebGPU」。

## 3. 资产分发（自托管，运行时零外联）

资产由 `npm run local:assets`（`scripts/copy-local-models.mjs`）下载到
`public/models/bge-small-zh-v1.5/`，**镜像 HF 仓库完整目录结构**（含 `onnx/`
子目录）。`public/models/` 为派生产物，不入库（`.gitignore` 忽略）。

约束：

- 下载源默认 `huggingface.co` 直连，`HF_MIRROR` 环境变量可切换
  （如 `https://hf-mirror.com`）；脚本按上表体积做完整性校验，缺文件即报错。
- 运行时不引用任何外部 CDN；`env.allowRemoteModels = false` 且 `env.remoteHost = ''`
  ——注意是**显式置空**而非"保持默认"（库默认值是 `https://huggingface.co/`），
  模型一律经 `from_pretrained('/models/bge-small-zh-v1.5', ...)` 从同源加载。
- ORT wasm 一律从根依赖 `node_modules/onnxruntime-web/dist` 拷贝（与 bundler
  解析到的是同一份副本）；脚本复制前校验已安装版本与 `package.json` 声明一致，
  版本漂移直接失败退出，避免 wasm 与 glue 错版。
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

实装状态（2026-11-12 复核）：`disposeLocalEngine()` 签名已为 `Promise<void>`（内含
`setTimeout(0)` 防迟到的 Worker 消息串入下一实例），释放接线已实装——`lib/local/engine-lease.ts`
以**租约引用计数**管理：`acquireLocalEngine()` 返回幂等释放函数，计数归零时才调用
`disposeLocalEngine()`；`hooks/useLocalEngine.ts`（能力页 / 设置分区）与聊天链路
（`hooks/useChat.ts`，随 `useEffect` 的 cleanup 释放）共用同一份计数，最后一个使用方
退出才 terminate，不会因数个使用方交替进出而反复销毁重建引擎。OCR 侧的
`disposeOcrWorker()` 已在 `/ocr` 页面接入。

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
- `search.ts` 只含纯函数：`cosineSimilarity`、`keywordScore`、`hybridScore`
  （= `VECTOR_WEIGHT × 向量分 + KEYWORD_WEIGHT × 关键词分`）、`chunkText`、
  `rankChunks`，以及通用取前 k 的 `topK<T>(items, k)`——它只负责截断排序结果，
  与向量运算解耦，由 `rankChunks` 内部调用。权重与预算常量
  `VECTOR_WEIGHT = 0.65` / `KEYWORD_WEIGHT = 0.35` / `DEFAULT_TOP_K = 4` /
  `DEFAULT_MIN_SCORE = 0.05` 由 `rankChunks(query, topKLimit, minScore)` 的默认
  参数消费，调用方不传即取默认；本文件不触碰 IndexedDB 与 Worker，
  `npm run smoke:rag` 直接可跑（AGENTS.md 脚本零依赖约定）。

### 5.4 触发条件（查询侧阈值）

`rag.enabled` 是**总开关**，不是「每条消息都检索」。实际是否发起检索由
`lib/local/rag/gate.ts` 的纯函数 `shouldRetrieve(query)` 决定：

```
有效字符数 = Array.from(query.replace(/\s+/g, '')).length   // 去空白，按字符计（代理对算 1）
shouldRetrieve = 有效字符数 >= RAG_MIN_QUERY_CHARS
```

- `RAG_MIN_QUERY_CHARS = 8`。v1 语料为 27 条种子知识卡，短输入（「你好」「谢谢」
  「1+1」「这题怎么做」）几乎不可能命中，却仍要付一次查询嵌入与 IndexedDB 读取，
  故设下限直接跳过。
- 定 8 而非 12 的实测依据：「二次函数顶点坐标怎么求」为 11 字符，是最短的正常数学
  问句之一；阈值 12 会把它误判为短句、静默不检索，8 既容纳该问句又挡住 5 字符级
  寒暄。用例见 `test/lib/local/rag/gate.test.ts`（13 项，含阈值 ±1 边界、全空白、
  中英混排、代理对）。
- 空白不计入有效字符：`'一'.repeat(6) + ' '.repeat(20)` 仍判为不检索，避免超长填充
  绕过下限。
- 未达下限属**设备内静默跳过**（§1 设备边界规则），不发提示、不阻断发送、不回落云端；
  消息照常裸发，仅请求体不带 `ragContexts`。
- **语料侧阈值不在本期落地**：种子卡数量固定（§5.1），语料规模阈值只在「用户会话 /
  笔记语料索引化」（§8）落地时才有意义，届时在本节补充「笔记语料 ≥ 3000 字才建索引」
  一类规则。

## 6. 聊天链路接入（ragContexts 契约）

本地 RAG 的第一个业务接入：**发送前在浏览器内检索，命中片段随请求体提交**，
服务端校验后注入上下文。数据流向：语料与查询都不出设备，提交给云端模型的
只有检索命中的片段本身（与用户消息同等地位，无额外隐私面）。

### 6.1 客户端（`hooks/useChat.ts`）

发送前若 `rag.enabled === true` 且 `shouldRetrieve(text)` 为真（查询侧阈值见 §5.4）：直接调用 `searchKnowledge(text)`
（嵌入 query → topK → 取回 chunk），命中则把 `{title, snippet(≤800), score(4 位小数)}`
附到请求体 `ragContexts`。链路**不额外判断引擎状态**：引擎未就绪时由 `embedTexts`
内部先 `initLocalEngine` 惰性拉起来，首次会触发 24–30MB 资产加载与编译，该条消息
因耗时过长不保证带上 `ragContexts`；任何抛错（资产缺失、Worker 启动失败、内存不足）
一律 **静默跳过**（消息照常裸发，设备内事件，§1），绝不阻断发送。

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

设置页「本地能力」分区（`components/settings/LocalCapabilitySection.tsx`）按任务
**四行**（路由绝对权在使用者）：

| 行 | 状态 | 内容 |
| --- | --- | --- |
| 图片处理（OCR） | **实装** | 开关写 `ocr.preferLocal`（自动 / 优先本地OCR），自通用设置迁入本分区，全站唯一开关 |
| 知识检索（RAG） | **实装** | 开关写 `rag.enabled`（默认 false）+ 命中口径说明；资产未就绪时「开启」置灰并给修复命令 |
| 本地引擎 | **实装** | 引擎状态 + 预加载入口（bge-small-zh-v1.5，WebGPU 优先、不可用时回退 WASM），下载进度经单例轮询回显 |
| 本地对话 | 占位 | v1 仅云端；本地选项禁用 + “未实装”标注（AGENTS.md §8） |

**「图片处理（OCR）」行位于本分区，通用设置不再保留同名条目**（2026-11-11 合并
`beta/browser-ocr` 时归并）：`ocr.preferLocal` 的语义与验收口径仍以
`browser-local-ocr.md` §6 为准，其资产探测（`checkOcrAssets`）、失败语义自成一套
（见 `browser-local-ocr.md` §3 / §5 / §6.4）；迁移只为消除同一开关在「通用设置」与
「本地能力」两处重复出现，两个分区各自保留唯一职责边界。预加载入口同样收敛到
「本地引擎」行一处，RAG 行不再重复提供预载按钮。

`UserSettings` 新增：

```ts
rag: { enabled: boolean };  // 【已接线】true=发送前浏览器本地检索并注入命中片段
```

normalize 规则：`rag.enabled` 严格 `=== true` 才为 true（与 `ocr.preferLocal` 同款从严布尔）。

代码侧逐项核对（2026-11-10，按当前实现实查）：

- **`rag.enabled` 已真实接线**：开关写 `settings.rag.enabled`；`hooks/useChat.ts`
  以 `useSettingsStore` 读取并在发送前检索（§6.1），依赖数组含 `ragEnabled`。
- **`checkLocalAssets()` 有真实调用方（共 3 处）**：①
  `components/settings/LocalCapabilitySection.tsx` 挂载时 `useEffect` 内
  `void checkLocalAssets().then(...)` 探测一次（`HEAD` + `no-store`，不缓存派生资产），
  结果驱动「开启」按钮 `disabled`、缺失清单与修复命令展示；② `hooks/useLocalEngine.ts`
  在 hook 挂载时探测一次，供「本地引擎」行与能力页读同一份就绪结论；③
  `app/(main)/local/_components/local-test-panel.tsx` 自检段①每次运行都 fresh 全量探测
  （不复用挂载期缓存，因为自检要判「此刻是否真就绪」）。**不是**只导出未使用的死代码；
  OCR 侧对应独立入口 `checkOcrAssets`（`browser-local-ocr.md` §3）。
- **引擎状态如实展示**：`getLocalEngineStatus()` 初始态 + 预加载按钮的 `progress`
  回调共同驱动 `[role="status"]` 文案；探测未完成时 `assets === null` 一律按
  「未就绪」处理，不做乐观假设。

## 8. 后续挂账（不属于本协议 v1）

- v2 小 LLM：Qwen3-0.6B 优先（新导出待核），Qwen2.5-0.5B-Instruct ONNX 备选
  （2026-11-10 实测：q4f16 483MB / q4 786MB / int8 512MB，单文件格式）；
  闲聊/FAQ 生成 + 非业务问询本地拦截。
- 云 OCR 两段管线（视觉模型转文字 → imageTexts → 纯文本模型）。
- 云端 embedding 选项、对话任务本地档位、模型镜像端点可配置（当前 `env.remoteHost`
  固定为空、不允许外联，属**有意锁定**而非待补功能）。
- 用户会话/笔记语料索引化（待数据层协议明确后扩展 §5.1）。
- Safari 26 WebGPU EP 内存问题跟踪（onnxruntime #26827）——影响 q4f16 档在
  Safari 的可用性，届时或对 Safari 强制 q8/wasm。

## 9. 已落地加固项：CSP

基础版 CSP 已随 `next.config.ts` 落地（原列在 §8 挂账，2026-11-10 复核后移出）。
`headers()` 以 `source: '/:path*'` 全站下发，指令只按实际实现需要放行：

| 指令 | 取值 | 放行理由 |
| --- | --- | --- |
| `default-src` | `'self'` | 默认全站同源 |
| `script-src` | `'self' 'unsafe-inline' 'wasm-unsafe-eval'`（dev 追加 `'unsafe-eval'`） | Next 内联 bootstrap 与防闪烁脚本；ORT / Tesseract 的 wasm 编译（只放开 wasm，不放宽 JS eval） |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind 运行时内联样式 |
| `img-src` | `'self' data: blob:` | Markdown 内联图与上传预览 |
| `font-src` | `'self' data:` | KaTeX 字体 |
| `connect-src` | `'self' blob: data:`（dev 追加 `ws: wss:`） | 本地资产 `fetch`、HMR |
| `worker-src` / `child-src` | `'self' blob:` | Turbopack 模块 Worker 与 ORT 多线程 wasm 的 blob Worker |
| `media-src` | `'self' blob: data:` | 语音/媒体预览 |
| `object-src` / `base-uri` / `form-action` / `frame-ancestors` | `'none'` / `'self'` / `'self'` / `'none'` | 基础加固；`frame-ancestors 'none'` 表示本站不提供被嵌入能力（等同 `X-Frame-Options: DENY` 的现代写法），不再放行同源嵌套 |

除 CSP 外，同一 `headers()` 条目还下发两条零成本加固头：

| 响应头 | 取值 | 理由 |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | 禁止 MIME 嗅探，避免 `public/models`、`public/ocr` 等自托管资产被误判为可执行脚本类型 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 跨源出站只带源站，避免站内路径信息外泄 |

仍未做（继续挂账）：严格 `script-src`、`require-trusted-types-for`、CSP 违规上报端点。

严格 `script-src` 的两条非 nonce 路线已于 2026-11-11 在生产构建 + 无头浏览器实测排除：
hash 白名单下 Next/Turbopack 注入的内联脚本全部被拒（全站 54 条 `script-src` 违规，
反闪烁脚本之外的框架脚本哈希随构建漂移不可白名单化）；实验性 `experimental.sri` 只给
外链资源加 integrity 属性，对内联脚本无帮助（违规数不变）。

> 口径校准（2026-11-11 合并 `beta/browser-ocr`）：该分支曾把 hash 白名单
> （`script-src 'self' 'sha256-…' 'wasm-unsafe-eval'`，dev 才放开 `'unsafe-inline'`）
> 连同 `ANTI_FLASH_SCRIPT_HASH` 常量一并带进 `next.config.ts`，本次归并**已丢弃该路线**，
> 保留 `'unsafe-inline'`（即上表口径），原因同上：生产构建实测 54 条 `script-src` 违规、
> 浏览器水合失败。今后不得再以 hash 白名单重试该方向。

nonce 路线受 `cacheComponents` 静态壳与 Next 16.4 `turbopackSharedRuntime` 内联
bootstrap 限制暂不可行（proxy 每请求发 nonce + `'strict-dynamic'` 与 PPR/静态预渲染
互斥，需放弃静态渲染架构才能落地），继续挂账待上游修复或架构决策。
*（内容由AI生成，仅供参考）*
