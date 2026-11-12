# 会话历史（Chat History）本地持久化协议

> 状态：批次 1（存储层 `lib/history/` 落地；UI 接线待批次 2）｜最后更新：2026-11-12
> 对应代码：`lib/history/types.ts`、`title.ts`、`sanitize.ts`、`contract.ts`、`memory.ts`、`indexeddb.ts`

本文件是会话历史的**唯一事实来源**。修改协议必须先改本文件，再改代码（`AGENTS.md` §9）。

---

## 1. 现状与范围

**改动前**（供对照，批次 2 后失效）：

- 消息纯内存：`hooks/useChat.ts` 的 `useState<ChatMsg[]>([])`，`clearMessages()` 直接置空，刷新即丢。
- `startNewChat()` 只递增 `newChatSignal`，`app/(main)/chat/page.tsx` 监听后清空，旧会话不留痕。
- 侧栏历史区占位「（对话历史将在后续接入）」，搜索框 `disabled`（`components/layout/AppSidebar.tsx`）。
- 文档口径为服务端方案「会话持久化 `/api/sessions` 未做」（`doc/user-settings.md`、`README.md`）。

**本协议改为本地持久化**，明确不做服务端会话 API：

| 维度 | 结论 |
| --- | --- |
| 存储位置 | 浏览器 IndexedDB（单库三张表），零新依赖 |
| 数据边界 | 只存本机浏览器；换设备、换浏览器、清站点数据即丢，不做同步 |
| 服务端 | 零持久化、零会话类 API（与 `user-settings.md` 的"无登录、无数据库"一致） |
| 自动删除 | **不存在**。会话与文本永不自动删除，删除一律由用户手动触发 |

---

## 2. 存储契约

### 2.1 选型理由（IndexedDB 而非 localStorage）

`ChatMsg` 带 `images`（dataURL，单张上限 `MAX_DATA_URL = 12MB`，见 `lib/chat/messages.ts`）与 `files`（单文件 20 万字符）。localStorage 的两个硬伤：

1. **配额 5MB**：一条带图消息即爆，且爆掉后整个 key 写入失败，无法只丢附件。
2. **同步阻塞 + 双份序列化税**：主线程 `JSON.stringify` 全量历史，长会话必卡。

IndexedDB 提供异步 API、按记录写入、独立的配额池，且可申请持久化（§3.3），是唯一不引依赖的可行选择。

### 2.2 库与表

```
数据库：notesync-chat-history（版本 1，升级只加不删）
```

| 表 | keyPath | 内容 | 索引 |
| --- | --- | --- | --- |
| `meta` | `id` | `SessionMeta`：会话头（标题、时间、条数、字节数），列表页只读此表 | `updatedAt`（游标倒序遍历） |
| `records` | `id` | `SessionRecord`：消息数组，**图片槽位一律为空串**，只存文本 | 无 |
| `blobs` | `key` | 附件本体：`value = dataURL` 原样存 | 无（按键前缀区间批量删） |

**为什么 records 不存图片**：列表页/搜索只需 `meta` 与文本；把 12MB 的 dataURL 和文本混在一条记录里，任何一次列表遍历都会把图片全读进内存。拆分后 `loadSession` 才按需回填。

### 2.3 消息与标题

- `records.messages` 形态为 `HistoryMessage = ChatMsg & { id?: string }`：`id` 可选，仅用于去重与 React key，缺省按位置重建。
- **图片槽位对齐**：`images[i]` 与 blob key 的 `imgIndex` 严格一一对应，因此清洗时**统一置空串、绝不压缩数组**（压缩会导致后续图片错位串台）。
- 标题规则：会话创建时取**首条用户消息正文前 20 字**（折叠空白、按码点截断，避免 emoji 被劈开）；无有效正文时回落「新对话」。用户手改后 `titleEdited = true`，此后自动逻辑不再覆盖标题。

### 2.4 附件键（BlobKey）

```ts
type BlobKey = `${sessionId}:${msgIndex}:${imgIndex}`
```

- 由 `makeBlobKey()` / `parseBlobKey()` 生成与解析，解析失败一律返回 `null`（脏 key 直接忽略）。
- 删除会话时按前缀 `sessionId:` 区间批量删（`IDBKeyRange.bound(\`${id}:\`, \`${id}:\uffff\`)`），避免遍历全表。

### 2.5 读写契约（`HistoryStorage`）

消费方（store / 组件）只依赖接口，当前实现为 IndexedDB，测试实现为内存：

| 方法 | 语义 |
| --- | --- |
| `supported` | 本环境是否可用；`false` 时整库降级为纯内存会话（§4） |
| `listSessions()` | 按 `updatedAt` 倒序返回全部 `SessionMeta`（不读消息体） |
| `loadSession(id)` | 读记录 + 按 key 回填图片；缺失的槽位保持空串并计入 `expiredImages` |
| `saveSession(meta, record)` | 整条覆盖写：文本入 `records`、附件入 `blobs`、头部入 `meta`，写前按 §3 定预算淘汰 |
| `renameSession(id, title)` | 只改标题，并置 `titleEdited = true` |
| `deleteSession(id)` | 删三处：`meta` + `records` + 前缀区间的全部 `blobs` |
| `loadBlob(key)` | 单张附件按需读取（图片懒加载用） |
| `estimate()` | 返回 `{ usage, quota }`，`usage` 取各会话 `attachmentBytes` 之和 |
| `clearAll()` | 清空三张表（仅用于"清空历史"手动入口） |

### 2.6 写入时序

- **流式生成中不写库**：`tool_call` / 文本 token 期间只更新内存；`done` / `error` / 用户主动停止后，debounce **700ms** 合并成一次事务写（`put records` + 增量 `put blobs` + `put meta`）。
- **切换/新建会话先 flush**：先落盘当前会话，再改 `currentSessionId`，避免"切得太快丢最后一段"。
- 图片本体与文本同批次写；若本次写附件触发配额错误，走 §4 的 `saved-without-attachments` 路径（消息照存，附件不入库）。

---

## 3. 容量上限

### 3.1 预算

| 预算 | 取值 | 说明 |
| --- | --- | --- |
| 单会话附件 | `20MB`（`SESSION_ATTACHMENT_BUDGET_BYTES`） | 只算附件字节，文本不计入 |
| 全局附件 | `min(300MB, quota × 0.3)`（`resolveGlobalAttachmentBudget`） | `quota` 取自 `navigator.storage.estimate()`；取不到时回落 300MB |
| 文本 | 无预算 | 文本永不因容量被淘汰（会话价值主体） |

### 3.2 淘汰算法（`planEviction`）

纯函数，输入按**时间顺序（最旧在前）**排列的附件引用列表与预算，输出需要过期的引用（最旧在前）：

1. 合计 `bytes` 未超预算 → 返回空数组（不动任何东西）。
2. 超出 → **从最旧的附件开始逐条淘汰**，直到合计不超预算。
3. 极端情况：若最新一张图单独就超预算，则连它一并淘汰（该图不入库，气泡上显示「图片已过期」）。

两级作用域：

- **会话内**：`[本会话全部附件（最旧在前）]` 对单会话预算 → 超了过期本会话最早的图。
- **全局**：`[全部会话附件，按会话 updatedAt 升序、会话内按 msgIndex 升序]` 对全局预算 → 超了从**最旧会话的最早附件**开始过期。

过期动作的完整副作用（三件事必须同批完成，缺一即孤儿数据）：

1. 删 `blobs` 中对应 key；
2. 把 `messages[msgIndex].images[imgIndex]` 置为 `''`；
3. 把 `{ msg, img }` 追加进 `record.expiredImages`。

### 3.3 持久化申请

首次成功写入后调用 `navigator.storage.persist()`，结果不阻塞任何流程（仅决定浏览器会不会在磁盘紧张时清掉本站数据）。不支持该方法的环境直接跳过。

---

## 4. 降级路径

| 故障 | 判定 | 行为 | 用户可见 |
| --- | --- | --- | --- |
| IndexedDB 不可用 | `supported === false`（隐私模式/禁用站点数据/`open()` 抛错） | 整体降级为纯内存会话：所有读写走内存实现，功能照常 | 侧栏顶部提示「当前浏览器不支持本地保存，本次对话不会留存」 |
| 写入配额超限 | `QuotaExceededError` | 本次附件不入库（`saved-without-attachments`），消息照存，不阻断发送 | 对应图片位置显示「图片已过期」 |
| 单条记录损坏 | `sanitize` 校验失败 | 单条 `delete`，不清库；其余会话不受影响 | 该会话从列表消失 |
| 消息字段脏数据 | 类型不符 / 超长 | 清洗后尽量保留（见下） | 无感 |

**清洗口径**（`sanitize.ts`）：同 `id` 去重（保留首条）、丢弃既无正文也无任何附件的气泡（避免空 assistant 幽灵条目）、非法 `role` 整条丢弃、`content` 超 20 万字符截断、非 `data:image/` 或不超 `MAX_DATA_URL` 的图片槽位置空串（**保位不压缩**）。

### 4.1 渲染契约

消息里 `images[i] === ''` 且 `{ msg, img }` 命中 `expiredImages` → 渲染灰底占位块「图片已过期」；`images[i] === ''` 但未登记过期 → 不渲染任何东西（属脏数据，不误导用户）。上行组装口径不变：`lib/chat/messages.ts` 只保留 `data:image/` 开头且不超限的项，空串天然被过滤，过期图片不会有任何一字节发到服务端。

---

## 5. 搜索口径

| 项 | 结论 |
| --- | --- |
| 算法 | `String.includes` 基础子串过滤，**不做分词、不做倒排索引** |
| 防抖 | 输入后 **200ms** 触发，避免每次按键全量扫描 |
| 匹配范围 | 会话标题 + 该会话全部消息正文（`content` / `files[].text` / `reasoning` 不计） |
| 归一化 | 两端 `toLowerCase()`；全角转半角后匹配（中文无大小写，但模型输出常混英文/数字） |
| 结果 | 返回命中的 `SessionMeta` 列表，按 `updatedAt` 倒序；命中条数上限 50 |
| 成本边界 | 会话数 × 消息数线性扫描；超过 500 个会话时只搜标题 + 最近 200 条消息（现实场景远达不到） |

不做索引的理由：会话正文总量以 MB 计，一次全扫在 10ms 量级；为搜索引入倒排索引的复杂度（增量维护、删除清理、版本迁移）远超收益。若将来实测卡顿，再按本表的"成本边界"升级。

---

## 6. 批次划分与未接线项

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 本协议 + `lib/history/` 六个文件（types / title / sanitize / contract / memory / indexeddb）+ 单测 | ✅ 本文件 |
| 2 | `store/useChatStore` 接入、`useChat` 落盘钩子、侧栏历史列表与搜索、过期图片占位渲染 | 待开工 |

批次 1 的诚实边界：`lib/history/` 已可独立工作并被单测覆盖，但**尚无任何 UI 调用**；侧栏历史区与搜索框在批次 2 完成前保持现有禁用状态（`AGENTS.md` §8：未实装能力不出现可交互控件）。
