# 会话历史（Chat History）本地持久化协议

> 状态：批次 1（存储层）、批次 2（UI 接线）均已落地｜最后更新：2026-11-12
> 对应代码：`lib/history/types.ts`、`title.ts`、`sanitize.ts`、`contract.ts`、`memory.ts`、`indexeddb.ts`、`storage.ts`、`search.ts`

本文件是会话历史的**唯一事实来源**。修改协议必须先改本文件，再改代码（`AGENTS.md` §9）。

---

## 1. 现状与范围

**改动前**（历史对照，批次 2 后已失效）：

- 消息纯内存：`hooks/useChat.ts` 的 `useState<ChatMsg[]>([])`，`clearMessages()` 直接置空，刷新即丢。
- `startNewChat()` 只递增 `newChatSignal`，`app/(main)/chat/page.tsx` 监听后清空，旧会话不留痕。
- 侧栏历史区占位「（对话历史将在后续接入）」，搜索框 `disabled`（`components/layout/AppSidebar.tsx`）。
- 文档口径为服务端方案「会话持久化 `/api/sessions` 未做」（`doc/user-settings.md`、`README.md`）。

**改动后**（批次 2 落地，当前口径）：

- 消息由 `hooks/useChat.ts` 在生成结束/停止后 debounce 落 IndexedDB，切换或新建会话前先 flush。
- 侧栏「最近记录」读 `meta` 表渲染会话列表；点击会话项即恢复该会话。
- 打开历史会话时 `images[i] === ''` 的槽位按 §4.1 渲染「图片已过期」占位块。
- 设置页「清除全部本地数据」追加 `storage.clearAll()`，与 `localStorage` 清理同批执行。

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

**渲染态字段**：`ChatMsg` 增加可选的 `expiredImages?: number[]`（本消息内已过期的图片下标）。它由 `useChat` 在 `loadSession` 后按 `SessionRecord.expiredImages` 折算写入，只供 `ChatList` 判断占位块，**纯展示态**：不落库（库里的真源是 `record.expiredImages` 的 `{msg,img}` 坐标）、不参与上行组装（`sendMessage` 的 messages map 不读该字段）。

---

## 5. 搜索口径（已移除）

侧栏会话历史搜索已整体下线，当前**不提供**任何会话检索入口：

| 项 | 结论 |
| --- | --- |
| 侧栏 UI | 搜索框已移除，历史区只有「最近记录」列表 + 新建/改名/导出/删除 |
| 检索能力 | `lib/history/search.ts`（子串匹配、防抖、命中合并、首条命中定位）连同单测一并删除 |
| 命中消费 | 聊天页不再有 `mark.search-hit` 高亮与 `search-hit-flash` 闪烁，`app/globals.css` 对应样式同步删除 |
| 跳转载荷 | `store/useChatStore.ts` 不再有 `PendingJump` / `pendingJump` / `clearPendingJump`，`openSession(id)` 只置 `pendingSessionId` 并递增信号 |
| 知识检索 | 与本文无关的本地 RAG 知识检索（`lib/local/rag/`）**不受影响**，仍在发送前按 `shouldRetrieve()` 门控注入上下文 |

移除理由：历史搜索是"按关键词找旧会话"的辅助入口，实际使用频次低，却要维护防抖扫描、正文回读上限、命中合并、DOM 层高亮与跳转时序一整套链路（正文回读还要按批读库）。下沉为纯列表后，侧栏逻辑只保留读取 `meta` 表，职责更单一，也避免了"跳转后吸底让位"这类跨组件时序耦合。

将来若要恢复检索，按本文件版本历史找回 `lib/history/search.ts` 与对应 UI 即可；会话数据结构（`meta` + `records`）未做任何变更，索引无需迁移。

---

## 6. 批次划分与未接线项

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 本协议 + `lib/history/` 六个文件（types / title / sanitize / contract / memory / indexeddb）+ 单测 | ✅ 已完成 |
| 2 | `lib/history/` 工厂与纯函数、`store/useChatStore` 接入、`useChat` 落盘钩子、侧栏历史列表、过期图片占位渲染、设置页清库扩展 | ✅ 已完成 |
| 3 | §8 会话与消息级操作：会话重命名、导出 Markdown、消息级删除 / 重新生成 / 编辑重发 | ✅ 已完成 |

---

## 7. UI 接线

### 7.1 状态归属

| 状态 | 归属 | 理由 |
| --- | --- | --- |
| `messages` / `loading` / `diagnoseContext` | `hooks/useChat.ts` 内部 `useState` | 会话内容只被聊天页消费；搬进 store 会让每次流式 token 都穿透全局订阅 |
| `currentSessionId` | `useChat` 内 `useRef` | 它在落盘时序里必须"同步可读"（flush 后再改），不能依赖 setState 异步可见 |
| `sessions`（列表）/ `historySupported` | `store/useChatStore.ts` | 侧栏与设置页共享；列表读 `meta` 表，不含消息体 |
| `openSessionSignal` + `pendingSessionId` | `store/useChatStore.ts` | 跨组件触发"打开某个会话"，与既有 `newChatSignal` 同款模式 |

**为什么用 signal 而不把 messages 搬进 store**：`useChat` 里的 `messages` 与流式 SSE 更新、abort、trace 生命周期强耦合，搬迁等于重写发送链路。signal + `pendingSessionId` 只新增两个 store 字段，chat 页 `useEffect` 消费后立即清空 `pendingSessionId`（避免重复打开）。

### 7.2 会话切换时序

1. 侧栏点击某会话 → `openSession(sessionId)`：置 `pendingSessionId` 并递增 `openSessionSignal`。
2. chat 页 `useEffect` 观测到信号变化 → 调 `useChat` 暴露的 `loadSession(sessionId)`。
3. `loadSession` 内：`abort` 进行中的生成 → **先 flush 当前会话** → `storage.loadSession(id)` → 命中则替换 `messages` 并更新 `currentSessionId`；未命中（记录损坏已被 `sanitize` 单条删除）则 toast 级提示并保持当前会话不变。
4. 消费完信号后 chat 页调 `clearPendingSession()`，恢复待命。

**新建对话**（顶栏按钮）沿用既有 `newChatSignal`：`clearMessages()` 改为"先 flush 旧会话，再置空 messages、`currentSessionId = null`"；新 id 在**首条消息落盘时**才生成（避免点开"新建"再返回就凭空多出一个空会话条目）。

### 7.3 落盘时机

- `done` / `error` / 用户主动停止（`stopGeneration`）→ 清 `loading` 后按 `SAVE_DEBOUNCE_MS`（700ms）debounce 写一次。
- 流式期间（含 `tool_call` streak）不写库，仅内存态。
- 写前刷新会话头：`refreshMeta(meta, messages, now)`；标题仅当 `titleEdited === false` 时用 `deriveTitleFromMessages(messages)` 重算。
- 写结果处理：`saved` 静默；`saved-without-attachments` 静默（图片位置已由 `expired` 回填 `ChatMsg.expiredImages`）；`unsupported` 静默（首帧已由 `historySupported === false` 给过一次提示，不重复打扰）。

### 7.4 侧栏交互

| 元素 | 行为 |
| --- | --- |
| 会话项 | 单行标题（`truncate`）+ 相对时间；当前 `currentSessionId` 高亮；点击即 §7.2 流程 |
| 删除 | 悬停/聚焦显示删除按钮 → `window.confirm` → `storage.deleteSession(id)` → `refreshSessions()`；删的若是当前会话，一并 `clearMessages()` |
| 降级提示 | `historySupported === false` 时列表区顶部固定一条「当前浏览器不支持本地保存，本次对话不会留存」，列表区显示空态 |

列表首次挂载即 `refreshSessions()`（读 `meta` 表，不碰消息体）；每次落盘成功后同步刷新一次，保证新会话立刻出现在列表。

### 7.5 过期图片占位

`ChatList` 对用户消息的 `images.map`：`src === ''` 且 `expiredImages.includes(idx)` → 渲染 `h-24 w-24` 灰底虚线块（文案「图片已过期」，`title` 说明"会话容量超限，此图已被清理"）；`src === ''` 且未登记 → 返回 `null` 跳过该槽位（不渲染破图）。其余情况照旧 `<img>`。

---

## 8. 会话与消息级操作（批次 3）

### 8.1 会话重命名

| 环节 | 口径 |
| --- | --- |
| 契约 | `storage.renameSession(id, title)`：`normalizeTitle` 规整（折叠空白 + 20 码点截断），空输入返回 `false` 表示拒绝；成功即置 `titleEdited = true` |
| 排序 | **不更新 `updatedAt`**：改标题不是会话活动，不应把旧会话顶到列表首位 |
| UI | 侧栏会话项双击标题进入内联输入；`Enter`/失焦提交，`Esc` 取消；提交值与原值相同或规整后为空 → 直接退出不写库 |
| 内存同步 | 改的是当前会话时，`useChat` 的 `sessionMetaRef` 必须同步 `{ title, titleEdited: true }`，否则下次 `flushSession` 会用旧标题覆盖（`store` 以 `renameSignal` + `renamedSession` 广播，规则同 §7.1 的 signal 模式） |
| 兜底 | 即便内存没同步到，`writeSession` 也以 `previousMeta.titleEdited` 优先取旧标题，避免"改完名又被自动派生覆盖" |

### 8.2 导出会话

- 纯函数 `buildSessionMarkdown(meta, messages)`：标题 + 创建/更新时间 + 消息数，逐条输出角色、正文、思考过程（折叠引用块）、工具调用摘要、诊断结果、附件清单；图片一律输出占位标记 `[图片]`，命中 `expiredImages` 的槽位输出 `[图片已过期]`，**不内联 dataURL**（导出物是给人读的文本，塞 base64 会让文件膨胀到不可用）。
- 文件名 `buildSessionFileName(meta, now)` → `notesync-<标题>-<yyyyMMdd-HHmm>.md`；标题里的路径分隔符与空白一律替换为 `-`，避免落盘失败。
- 导出内容取自**库内已落盘快照**（`storage.loadSession`），不读内存态：侧栏与聊天页不共享 `messages`，也不应为导出新增跨组件读取通道。若当前会话正在生成，导出物缺末尾未落盘部分——这属于已知取舍，UI 用 `title` 说明。
- 触发入口：侧栏会话项悬停的第二枚图标（`↓`）。

### 8.3 消息级操作

| 操作 | 语义 | 实现要点 |
| --- | --- | --- |
| 重新生成 | 截断最后一条 user 消息之后的全部内容，重发该条 | 复用 `sendMessage`；上行历史改读 `messagesRef`（见下） |
| 编辑重发 | 截断到目标 user 消息**之前**，用新正文重发，附件沿用原条 | 只改正文，`images`/`ocrTexts`/`imageSendMode` 原样带回 |
| 删除单条 | 从 `messages` 移除该条 | 删空即等价"会话作废"：清内存态并 `deleteSession`，不留空壳条目 |

**索引收缩契约（本节唯一新增的硬约束）**：`expiredImages` 的 `msg` 是消息下标，与 blobs 的 `sessionId:msgIndex:imgIndex` 严格对齐。任何改变消息数量的操作都必须同批处理坐标：

- 删除下标 `removedAt`：`msg > removedAt` 一律减 1，`msg === removedAt` 丢弃（该条连同它的过期登记一起消失）。
- 截断（重新生成 / 编辑重发）：只保留 `msg < keepLength` 的登记。

对应纯函数 `shiftExpiredRefsOnDelete(refs, removedAt)` / `trimExpiredRefs(refs, keepLength)`（`lib/history/contract.ts`）。**不做这一步的后果**：错位的过期登记会落到别的消息上，渲染层把好图显示成「图片已过期」。附件本体无需手工迁移——`writeSession` 覆盖写前会 `delete(sessionKeyRange(id))` 清空本会话 blobs，再按新下标重建。

**上行历史口径修正**：`sendMessage` 组装请求体时一律读 `messagesRef.current`，不再读 `messages` 闭包。重新生成/编辑重发要先剪枝内存态再调发送，闭包值此时仍是剪枝前的数组，会把本轮要丢弃的旧回答一起上行。

**落盘与禁用**：三种操作都走 §7.3 的 700ms 合并落库；`loading` 期间全部禁用（生成中改历史会让流式 `appendAssistant` 写到最后一条错位的消息上）。

**UI**：消息气泡悬停/聚焦显示操作条（`components/chat/MessageActions.tsx`）：user 消息给「编辑 / 删除」，assistant 消息给「复制 / 删除」，最后一条 assistant 额外给「重新生成」。触屏常显（同 `doc/mobile-ux.md` §4）。
