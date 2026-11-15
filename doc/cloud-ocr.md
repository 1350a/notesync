# 云端 OCR 协议（cloud-ocr）

> 状态：v1 实装（引擎维度接入转写链路；2026-11-14 引擎默认档改云端、preferLocal 删除）｜创建：2026-11-12
> 对应代码：`lib/ocr/cloud.ts`（服务端客户端）、`app/api/ocr/route.ts`（代理路由）、
> `lib/ocr/image-handling.ts`（engine 分流）、`components/settings/LocalCapabilitySection.tsx`（开关）

## 1. 定位与范围

**云端 OCR 根本上是为纯文本模型服务的**：用户未选择多模态模型时，图片必须先转成文字
才能被诊断模型"看到"。这条转写链路此前只有本地 tesseract（chi_sim）一个引擎，而
diagnosis-model.md §1.3 已把本地 OCR 文本定为"中低可信、优先怀疑识别"——公式、手写、
复杂版面恰是错题场景的常态。本协议引入智谱专用 OCR 模型 **glm-ocr** 作为第二个转写引擎。

与既有概念的关系（2026-11-14 起，档位随模型能力自动路由，见 product-vision.md P4）：

| 维度 | 取值 | 说明 |
|---|---|---|
| 路径（自动派生） | `ocr-text` / `direct` | 多模态模型 → `direct` 原图直传（无转写）；纯文本/能力未知 → `ocr-text` 转写后发送。旧 `mixed` 混合档已下线（服务端组装仅为旧历史重发保留兼容）。协议见 browser-local-ocr.md §6 |
| 引擎（本协议） | `local` / `cloud` | 决定**谁来做转写**；转写只发生在 `ocr-text` 路径，`direct` 无转写、引擎无关 |

即路径由模型能力唯一决定、引擎由用户选择：选云端引擎表达的是"转写质量优先于本地
隐私"。云端引擎的全部受益者就是纯文本模型路径（`ocr-text`）——公式、手写、复杂版面
由 glm-ocr 承接。

**默认引擎为云端（2026-11-14 拍板，替代旧「默认 local」）**：纯文本模型路径默认走
glm-ocr，图片像素默认出端至智谱；切「本地」是隐私动作。同意面 = 上传前可见提醒
（聊天常驻短句 + 首次一次性说明、诊断区常驻说明）+ 设置页「图片处理（OCR）」行（见 §3）。

## 2. 模型与端点（2026-11-12 查证）

| 项 | 值 |
|---|---|
| 模型名 | `glm-ocr`（0.9B 专用文档解析模型，不走 chat/completions，不进对话模型下拉） |
| 端点 | `POST {ZHIPU_BASE_URL}/layout_parsing`（ZHIPU_BASE_URL 缺省 `https://open.bigmodel.cn/api/paas/v4`） |
| 鉴权 | 复用 `ZHIPU_API_KEY`（Bearer），不新增环境变量 |
| 输入 | `file`: 图片 URL 或 base64（本协议用 base64，去 dataUrl 前缀）；仅 JPG / PNG |
| 限制 | 单图 ≤ 10MB；不支持 webp / bmp（detect 层放行的格式在此收窄，见 §6 失败语义） |
| 输出 | `md_results`（Markdown 全文，表格为 HTML）+ `layout_details`（逐块 label/bbox/content） |
| 定价 | 0.2 元/百万 tokens（官方口径 1 元 ≈ 2000 张 A4 图） |

`layout_details` 本轮随响应透传给调用方但 UI 不消费——为后续"疑似非题目"启发式与
相关性判断（挂账 §8）留口，消费方落地时先改本协议。

## 3. 设备边界与同意（P4 关联）

- **云端引擎意味着图片像素上行至智谱 OCR 端点**（目的地与诊断模型不同）。2026-11-14
  拍板后它是**默认引擎**：同意面 = 上传前的可见提醒 + 设置页「图片处理（OCR）」行。
  提醒不是一行设置页说明（那样等于没人看见），实装为两层：聊天输入区常驻一行短句
  （弱化色、单行、不占额外纵向空间）+ 首次选文件/粘贴图片时的一次性详细说明；诊断
  上传区常驻完整三点说明（product-vision.md P4 约束①，落点见 file-intake.md §1）。
  切「本地」是隐私动作，无需额外同意。
- **文案不得替服务商承诺**：本站可自证的是"经本站服务端代理转发、不落盘保存"
  （`app/api/ocr/route.ts` 无持久化）；智谱侧的留存与训练策略以其服务条款为准，
  文案只写"以服务商条款为准"，不写"不用于训练"（夸大即不实）。
- **不静默回落**：云端识别失败 → 阻断 + 逐张原因 + 用户决策（移除 / 改本地引擎重试），
  绝不静默改走本地；本地引擎失败同理绝不静默改走云端（browser-local-ocr.md §6.4 同源）。
- 回显确认面板（diagnosis-model.md §1.3 规则①）对两引擎统一生效：云端引擎下面板标题
  必须改为"图片已发送至智谱 OCR"，不得保留"图片未离开设备"的陈述。

## 4. 设置契约（`ocr.engine`）

```ts
type OcrEngine = 'local' | 'cloud';

ocr: {
  engine: OcrEngine;  // 转写引擎：cloud=智谱 glm-ocr（默认）；local=tesseract.js 浏览器内
}
```

- 默认 `'cloud'`（2026-11-14 拍板，质量优先；旧 `preferLocal` 档位偏好字段已删，
  语义并入自动路由——要不要转写只看模型能力，browser-local-ocr.md §6.1）。
- normalize（`lib/settings/types.ts`）：`engine` 非 `'local'/'cloud'` 一律回落 `'cloud'`；
  旧存储数据无该字段 → 补默认 `'cloud'`；旧存量 `ocr.preferLocal` 键按"未知字段丢弃"
  自然清除（**隐私敏感存量会被迁到云端引擎**，这是拍板内容的一部分，不单独迁移）。
- **可用性门禁**：zhipu Provider 处于 `unconfigured`（无 ZHIPU_API_KEY）时，设置页云端
  选项置灰并提示缺失项（AGENTS.md §8 诚实接线；探测来源 GET /api/models 的 providers 明细）。
  运行中钥匙失效（如上游 401）按 §6 失败语义暴露，不做前置兜底、不静默回落本地。

## 5. 服务契约（POST /api/ocr）

单图单请求（客户端并发调度 + 逐张进度，与本地引擎粒度一致）：

```ts
// 请求体
{ image: string }   // dataUrl，必须 data:image/(png|jpeg|jpg);base64, 前缀

// 响应 200
{ text: string; layoutDetails?: unknown }   // text 为 md_results（可能为空串，空=客户端按失败处理）
```

错误响应（JSON，非 SSE）：

| HTTP | code | 含义 |
|---|---|---|
| 400 | `invalid_request` | 请求体非 JSON / 缺 image / 前缀不是 `data:image/(png\|jpeg\|jpg);base64,` |
| 413 | `image_too_large` | 解码后超过 10MB（glm-ocr 单图上限） |
| 503 | `unconfigured` | ZHIPU_API_KEY 缺失 |
| 502 | `provider_error` | 上游非 2xx（message 取上游摘要，不贴整段响应） |
| 500 | `parse_error` | 上游 2xx 但结构不符合 layout_parsing 契约 |

**MOCK 开关**：`MOCK_OCR=1` 时不碰上游，直接返回占位文本（`[MOCK]云端OCR转写占位`），
用于零 token 验证接线（与 diagnose-file-intake.md §8 的 MOCK_MODEL=1 同思路）。
`.env.example` 同步收录。

服务端只做校验与委托（AGENTS.md §2），base64 直传，不落盘、不打图片日志；错误日志
经 `lib/safety/redact.ts` 的 `extractUpstreamMessage` 摘要化（与 chat 链路同口径）。

## 6. 客户端接线与失败语义

- 分流点：`lib/ocr/image-handling.ts` 的 `convertImagesToTexts(images, onProgress, engine)`——
  `'local'` 走既有 `ocrRecognize`（tesseract），`'cloud'` 走 `POST /api/ocr`。返回结构
  （texts / confidences / failures / elapsedMs）两引擎同形：云端无 tesseract 置信度，
  `confidences` 恒为 `null`，低置信标红规则仅适用于本地引擎。
- 失败语义沿用 browser-local-ocr.md §6.4：`ocr-text` 路径（识别文本是唯一通道）→
  **阻断发送**，逐张列明原因，提示"移除该图或在设置中切换识别引擎后重试"。
  （旧 mixed 档"不阻断只提示"的分支随混合档下线取消。）
- 空识别结果（`text` 为空串）两引擎同口径按失败处理："未识别到文字（图片中可能没有文本）"。
- webp / bmp：2026-11-14 起在**接入段**（`lib/intake/extract-image.ts`，doc/file-intake.md §6）
  统一规范化为 PNG/JPEG，云 OCR 不做任何转格式——`/api/ocr` 的 JPG/PNG 门禁语义不变，
  收到其他格式仍按 400 拒绝（那是异常路径，不再是常规失败语义）。旧句"不静默转格式"
  修订为：转换在接入段显式完成且格式留痕，不藏在 OCR 失败路径里。
- 文案随引擎切换（AGENTS.md §8）：进度文案（"本地OCR识别中/云端OCR识别中"）、
  档位代价说明（"原图不出设备"仅本地引擎成立）、确认面板标题（§3）随 `ocr.engine` 派生，
  不允许文案与实际行为背离。

## 7. 证据可信度（diagnosis-model.md §1.3 新行）

云端 OCR 识别文本按"**中**"计（高于本地 OCR 的中低——专用模型对公式/表格/手写的
识别显著更好；仍低于多模态直读——转写丢失版面与图形信息）。冲突处理与其它识别证据
相同：回显确认，优先怀疑识别而非学生。落点在 diagnosis-model.md §1.3 表，此处不重复定义。

## 8. 挂账（不属于本协议 v1）

- **layout_details 启发式**："疑似非题目"标注（块统计：无文本块/纯图形页）。
- **相关性判断**：视觉对话模型看原图软提示（glm-5.3-flash，不阻断）或 glm-ocr 转写后
  免费文本模型后置判断——本轮不做，契约已留 layoutDetails 口。
- **扫描件 PDF**：glm-ocr 直收 PDF（≤100 页），接入 extract 段销
  diagnose-file-intake.md §9 挂账，需单独协议（页数/预算与现有 PDF 文字层路径的取舍）。
- **dataUrl 前缀兼容性实测**：官方文档仅写 base64，`data:image/...;base64,` 前缀是否被
  接受以本轮冒烟为准。**2026-11-12 冒烟结论**：直发裸 base64 时鉴权通过、错误链路全通
  （429「余额不足」经摘要管道正确回显），但账号无 glm-ocr 资源包，转写成功路径被
  拦截，base64/dataUrl 兼容性仍未定论——充值或领取资源包后执行 `npm run smoke:ocr`
  复验并回填 §2。路由侧已实测：非法前缀 → 400、非 JSON → 400、上游 429 → 502 + 摘要。
  **2026-11-13 充值后复验（已定论）**：裸 base64 被上游按「无扩展名文件路径」拒识
  （HTTP 400「仅支持PDF、JPG、PNG、JPEG格式」）；`data:image/(png|jpeg);base64,`
  **带前缀 dataUrl 实测 200**（529ms，md_results 44 字符，公式正确转 LaTeX）。
  `cloudOcrRecognize` 已改为固定拼接前缀（fix 82c50b7），本条销账，成功路径以
  `npm run smoke:ocr` 为准持续可验。
