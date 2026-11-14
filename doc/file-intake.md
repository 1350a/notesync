# 文件上传统一接入契约（file-intake）

> 状态：v1（与实现同步落地）｜创建：2026-11-14
> 对应代码：`lib/intake/`（detect / decode-text / extract-image / extract-office）、
> `app/api/parse-doc/route.ts`、`components/chat/ChatInput.tsx`、
> `app/(main)/diagnose/_components/UploadArea.tsx`

本文件定义**两个上传入口**（聊天输入框、诊断页）共用的文件接入契约：
类型判定、文本编码探测、图片规范化、Office 解析、服务端 .doc 端点、移动端拍照。
诊断页特有的四类标签与组装预算见 `diagnose-file-intake.md`，本文不重复。

## 1. 链路总览

架构不变：**浏览器端提取成文本 / dataUrl → JSON 上行**，服务端只新增 `.doc` 一个解析端点。

```
选文件 → detect（魔数+扩展名）→ extract（intake 四模块）
  ├─ 图片   → extract-image（heic 阶梯 / 规范化 / 缩放）→ dataUrl
  ├─ 文本   → decode-text（编码探测）→ text
  ├─ Office → extract-office（mammoth/jszip/SheetJS）→ text
  └─ .doc   → POST /api/parse-doc（word-extractor）→ text
```

隐私口径（AGENTS.md §8，UI 文案必须照实表述）：

| 类型 | 内容去向 |
|---|---|
| 图片 / 文本 / docx / pptx / xlsx / xls | 浏览器本地解析，**不出设备**（图片随后续档位口径另行判定） |
| `.doc` | base64 上传到**自有服务端**解析，UI 必须明示"将上传到服务器解析" |
| 云 OCR / 多模态直传 | 口径不变，见 doc/cloud-ocr.md §3 |

## 2. 支持格式表

| 类别 | 扩展名 / 格式 | 判定方式 | 入口 | 解析方 |
|---|---|---|---|---|
| 图片 | png jpg jpeg webp bmp avif ico | **魔数**（§3） | 两入口 | extract-image → dataUrl |
| 图片（阶梯） | heic heif | 魔数 + 阶梯（§5） | 两入口 | canvas → heic2any |
| 纯文本 | TEXT_EXTENSIONS 白名单（~40 种，随代码迁移到 `lib/intake/detect.ts`） | 扩展名 + `text/` MIME | 两入口 | decode-text |
| Word | docx | 扩展名 | 两入口 | mammoth（客户端） |
| Word 旧版 | doc | 扩展名 + OLE 魔数（服务端复验） | 两入口 | `/api/parse-doc`（服务端） |
| 幻灯片 | pptx | 扩展名 | 两入口 | jszip 抽 slide XML（客户端） |
| PDF | pdf | 扩展名 / MIME | 两入口（2026-11-14 起聊天也收） | pdfjs 文字层（§7） |
| **拒收：gif** | gif | 魔数 `GIF8` | 两入口 | 提示"动图请截帧后上传"（拍板排除） |
| **拒收：ppt** | ppt | 扩展名 | 两入口 | 提示"另存为 pptx 后上传"（§10 挂账） |
| **拒收：表格** | xlsx xls | 扩展名 | 两入口 | 提示"另存为 CSV 后上传"（CSV 走纯文本通道；§10 挂账） |
| 拒收：其他 | — | — | 两入口 | 提示明确原因 |

聊天输入框的 accept 串 = `image/*` + 文本白名单 + `.pdf/.docx/.doc/.pptx`
（ppt/xlsx/xls 不进 accept，强选仍拒收并给指引）；诊断页不加 accept（沿用 detect 白名单）。

## 3. 类型判定（detect）

- **图片一律按魔数判定，不用扩展名**：iOS 相册经 Safari 上传时系统把 HEIC 转成
  JPEG，但文件名可能仍是 `IMG_xxx.HEIC`（2026-11-14 查证）；扩展名会误判。
  魔数表：JPEG `FF D8 FF`、PNG `89 50 4E 47`、WEBP `RIFF…WEBP`、BMP `BM`、
  GIF `GIF8`、HEIC/HEIF `ftyp` box brand（heic/heif/mif1/msf1）、AVIF `ftyp avif`。
- **Office 按扩展名**：`PK\x03\x04` 魔数只证明是 ZIP 容器，区分不了 docx/xlsx/pptx；
  doc/xls 的 OLE 魔数（`D0 CF 11 E0`）在服务端 `/api/parse-doc` 复验，前端信任扩展名。
- 判定产出统一形态：`{ category: 'image' | 'text' | 'office' | 'doc' | 'rejected', format, rejectReason? }`。
  诊断页 `lib/diagnose/detect.ts` 在其上映射 DiagnoseKind，两入口不各写一套判据。

## 4. 文本编码探测（decode-text）

`ArrayBuffer → { text, encoding, warning? }`，零依赖（浏览器 TextDecoder 原生支持
gb18030 等扩展编码）：

1. **BOM**：`EF BB BF` → utf-8；`FF FE` → utf-16le；`FE FF` → utf-16be。
2. **无 BOM**：`TextDecoder('utf-8', { fatal: true })` 严格试解 → 成功即 utf-8。
3. **试解失败** → `gb18030` 兜底（GB18030 是 GBK 超集，覆盖 Windows 中文环境常见
   ANSI 文件；大字集差异极罕见）。
4. **二进制防线**：解码前统计 NUL 字节占比 > 1% 或 UTF-16 判定外的零散 NUL →
   判疑似二进制，拒收（不产出乱码文本）。

`file.text()` 在两入口全部弃用（旧实现的乱码根源）。

## 5. HEIC 三级阶梯（extract-image）

| 级 | 动作 | 依据 |
|---|---|---|
| 1 | canvas 原生试解码 | iOS 17+ / Safari 原生支持 HEIC 解码，零成本 |
| 2 | 动态 `import('heic2any')` 转 JPEG | 失败才拉 ~2MB wasm，仅 Android HEIF 机型与桌面手选 .heic 会走到 |
| 3 | 拒收 | 提示"转成 JPG/PNG 再传" |

背景：iPhone 相册上传 Safari 自动转 JPEG，遇到 HEIC 的主要是 Android
（相机开 HEIF）与桌面文件，见 §10 查证记录。

## 6. 图片规范化与缩放（extract-image）

- **格式规范化**：魔数为 bmp → canvas 转 PNG（截图类居多，保文字锐利）；
  webp / avif / 其他可解码位图 → canvas 转 JPEG（质量 0.92，透明垫白底）；
  jpg / png 原样保留不重编码。规范化发生在**接入时**（显式协议步骤），
  云 OCR 自身不做任何转格式——`/api/ocr` 的 JPG/PNG 门禁语义不变。
  此条修订 cloud-ocr.md §6 旧句"不静默转格式"：转换在接入段完成且格式留痕，
  OCR 失败路径不再是转格式的兜底点。
- **尺寸缩放**：最长边 > 4096px 或原始字节 > 4MB 时，canvas 缩到最长边 ≤ 2048px
  （why：防 MAX_DATA_URL 12MB 丢弃、OCR 提速；2048px 对错题照片与试卷截图足够）。
- 输出统一 `data:image/png|jpeg` 前缀 dataUrl，格式与是否缩放写入返回值供 UI 留痕。

## 7. Office 与 PDF 解析（extract-office / extract-pdf）

| 格式 | 库 | 输出 |
|---|---|---|
| docx | mammoth | 纯文本（换行保留段落） |
| pptx | jszip 抽 `ppt/slides/slideN.xml` 的 `<a:t>` 文本 | 按页分组，`【第 N 页】` 前缀 |
| pdf | pdfjs-dist 文字层（两入口共用 `lib/intake/extract-pdf.ts`） | 纯文本，上限 80 页 |

- 全部**动态 import**：选中对应文件才拉库，不进首屏 bundle。
- 字符上限参数化：聊天 200_000（对齐 `MAX_TEXT_FILE_CHARS`）、诊断 20_000
  （对齐既有 `MAX_PDF_CHARS`）；超限截断并留 warning。
- 单文件失败不抛错：空结果 + warning（与 diagnose-file-intake.md §4 同口径）。
- PDF 文字层提取自诊断页迁出共用：扫描件（无文字层）返回空文本，调用方给出
  "可能是扫描件" 提示。
- pdfjs 运行时资源三件套（worker / `cMapUrl` / `standardFontDataUrl`）全部指向
  本地静态资源 `public/pdfjs/`（自 node_modules/pdfjs-dist 全量拷入；升级
  pdfjs-dist 版本后需同步重拷 worker 与这两个目录）。缺 cMapUrl 时，预定义
  CMap 编码的中文 PDF（未嵌入字体：WPS 导出、试卷下载站等常见来源）文字层
  解码失败返回空，会被误判成扫描件（2026-11-14 实测，见 §12）。

## 8. 服务端 `.doc` 端点（POST /api/parse-doc）

请求（JSON）：

```ts
{ dataUrl: string; name: string }  // dataUrl 必须 data:application/msword;base64, 或任意 base64（以魔数为准）
```

响应：

| 状态 | body |
|---|---|
| 200 | `{ text: string }` |
| 400 | `{ error: 'invalid_request', message }` —— 非 JSON / 非 dataUrl / 名缺 |
| 400 | `{ error: 'unsupported_format', message }` —— OLE 魔数不符（伪装的 doc） |
| 413 | `{ error: 'too_large', message }` —— base64 解码后 > 20MB |
| 500 | `{ error: 'parse_error', message }` —— word-extractor 解析失败 |

- 解析库：`word-extractor`（纯 JS，无原生依赖），worker 不落盘、不打内容日志。
- 20MB 上限 why：.doc 实际场景远小于此，防请求体滥用（`readJsonBody` 无长度上限）。
- MOCK：`MOCK_PARSE_DOC=1` 时跳过解析返回占位文本（零依赖验证接线）。

## 9. 移动端附件入口（capture）

- **2026-11-14 拍板**：独立"相机"按钮取消（聊天输入区与诊断上传区同口径）——
  移动端底栏空间有限，相机入口收敛进附件按钮。
- 触屏设备（`pointer: coarse`）点附件/上传按钮**不直接开文件选择**，而是就地展开
  **列表式两选项**（非弹窗、非模态，锚定在触发按钮旁）：
  - 「选择文件」→ `<input type="file" multiple>`；
  - 「拍照」→ `<input type="file" accept="image/*" capture="environment" />` 直调系统相机。
- 桌面（`pointer: fine`）点附件按钮直接开文件选择，不出现列表（capture 在桌面无意义）。
- 拍照产物为 JPEG，走与相册选图完全相同的 extract-image 链路（含规范化与缩放）。
- 真机拍照行为无法桌面自动化，验收以实机为准（见 §12）。

## 10. 挂账

- **ppt 旧版解析**：纯 JS 前后端均无解；候选方案是智谱文件解析 API（需验证 ppt 支持），
  验证前维持拒收提示"另存为 pptx"。
- **xlsx / xls 表格解析**（2026-11-14 拍板暂缓）：SheetJS 版本取舍两难——
  npm registry 仅 0.18.5（含两条已知 CVE，触发面为解析恶意构造表格，本项目仅
  上传者本机自解析，风险自限），新版 0.20.x 只在 SheetJS CDN（当前网络不可复现
  安装，`npm install` 会卡死他人环境）。后续需要时走 vendor 入库（需修订
  git-commit-convention §5 压缩包禁项）或自托管 CDN tarball，再接入
  `sheet_to_csv`（导出层已在本轮验证过可行）。拒收文案引导"另存为 CSV"
  （CSV 走纯文本通道，编码探测同样生效）。
- **编码误判**：GB18030 兜底覆盖绝大多数中文场景；如反馈出现 Latin-1/Shift_JIS 误判，
  再评估引入 jschardet。
- **扫描件 PDF 兜底**（2026-11-14 调查结论，本轮不做）：真扫描件（无文字层）目前
  两入口均为死路（诊断页行内警告 + 聊天页 4 秒提示）。glm-ocr 服务端支持 PDF 直传
  （≤100 页，cloud-ocr.md §8 冒烟的 400 文案「仅支持PDF、JPG、PNG、JPEG格式」反向
  证实）；多模态 chat 模型普遍不吃 PDF。候选设计：cloud 引擎下无文字层 PDF 直传
  glm-ocr 转写；local 引擎下渲染页转图走既有图片链路。接入需单独协议（页数/预算
  与文字层路径的取舍），与 cloud-ocr.md §8 同一挂账。
- **移动端附件菜单二次弹层**（2026-11-14 真机观察，待拍板）：聊天页「选择文件」的
  accept 含 `image/*`，Android 弹系统级「文件/拍照相机」来源选择层，与菜单内「拍照」
  项路径重复；诊断页文件入口无 accept，直进文件选择器无此层。候选方向：移动端文件
  入口 accept 去 `image/*` 并补「相册选图」项；或把文件/相机的分派整体交由系统层。
  动代码前先修订本节协议。

## 11. 测试与冒烟

- 单测：`test/lib/intake/`（decode-text 造 GBK/UTF-16LE/BOM/二进制样本；
  detect 魔数表；extract-office 用 jszip 现场造最小 fixture）、`test/lib/parse/doc.test.ts`。
- 冒烟：`scripts/file-intake-smoke.ts`（File 对象 detect 端到端 + 编码探测 +
  `/api/parse-doc` 校验与错误路径，零依赖直跑）。真 .doc 解析需真实文件，
  难以程序化构造——留实机验收（用任意旧版 Word 文件过一遍两入口）。

## 12. 查证记录

- **2026-11-14 相册上传格式**：iOS Safari 文件选择器在 accept 含图片类型时自动把
  HEIC 转 JPEG（WebKit"最兼容"传输），原始 HEIC 仅"存到文件 App 再传"可得；
  Android Chrome 原样上传（三星 HEIF 机型会传真 HEIC）。
  来源：stackoverflow.com/q/64093027、news.ycombinator.com/item?id=23260987。
- **2026-11-14 PDF 中文 CID 字体实验**：node 下用项目同款 pdfjs-dist 5.6.205 提取
  手工构造的 STSong-Light（GB-EUC-H 预定义 CMap）最小 PDF——无 `cMapUrl` 时
  getTextContent 返回空（警告 "Ensure that the cMapUrl API parameter is provided"，
  即被判"扫描件"）；补 `cMapUrl` 后提取出正确中文。Helvetica 对照组始终正常，
  排除提取管线本身故障。结论：中文 CID 字体 PDF 必须配 cMaps 静态资源。
