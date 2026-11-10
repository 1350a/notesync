# 用户设置抽象层 + 侧栏式设置 UI（修订版）

## Context

无登录系统、无数据库，配置存前端；本轮**取消自定义模型**，仅先实现**类抽象**：声明设置怎么用（类型 + 存储接口 + 消费方式），UI 参考 提供的图：弹窗左侧固定侧栏（通用设置/账号管理/数据管理/服务协议），右侧内容区。密钥仍按 AGENTS.md §7 只走环境变量，客户端密钥设计随自定义模型一并延后。

## 核心设计决策

1. **抽象优先**：`lib/settings/` 定义 `UserSettings` 模式 + `SettingsStorage` **接口**（load/save/reset），具体实现为 localStorage（版本化 key `notesync-settings.v1`，损坏回落默认值，SSR guard）。将来换服务端存储只换实现，不动消费方——这就是"声明设置怎么用"。
2. **UI 按 §8 诚实接线**，侧栏四项：
   - **通用设置**（实装）：主题三选卡片 浅色/深色/跟随系统（`theme: 'light'|'dark'|'system'`，system 用 `matchMedia` 监听并随系统实时切换）；默认模型下拉（记忆选中项，刷新不丢）；语言、朗读音色两行按参考图保留但**禁用 + "未实装"标注**
   - **账号管理**：无账号体系，仅文案说明"配置仅存本浏览器"，不放假控件
   - **数据管理**（实装）：恢复默认设置 / 清除全部本地数据（`notesync-*` localStorage key + 刷新）
   - **服务协议**：静态文案（本地存储声明、无遥测、密钥仅环境变量）
3. **模式声明但本轮不接线**（UI 不出现，doc 挂账）：`generation`（temperature/maxTokens）、`systemPrompt`、`ocr.preferLocal`、`language`——字段在类型与 doc 中占位，服务端注入等下一轮做。
4. **client 身份（user_id）**：`lib/client-id.ts` 生成 UUID 存 localStorage，`/api/chat`、`/api/models` 请求带 `X-Client-Id` 头，服务端仅打日志（`[chat] client=…`）——服务端保持逐请求无状态，天然支持少量并发；为将来会话存储/配额预留钩子。
5. **主题从 `useChatStore` 迁入设置**：`useChatStore` 只留纯 UI 态（弹窗开关/侧栏/新建信号）；AppLayout 负责水合 + 应用主题类。
6. 删除零引用死代码 `lib/config.ts`。

## 文件清单（一文件一提交，`<type>: <中文描述>`，doc 先行）

1. `doc/user-settings.md`（新）— 设置模式/默认值/版本化合并规则、SettingsStorage 接口契约、UI 各区实装状态表、X-Client-Id 协议、未接线字段挂账（generation/systemPrompt/OCR/密钥策略）
2. `lib/settings/types.ts`（新）— `UserSettings`、`DEFAULT_SETTINGS`、`normalizeSettings(unknown)`（收窄 + 钳制，纯函数可冒烟）
3. `lib/settings/storage.ts`（新）— `SettingsStorage` 接口 + localStorage 实现
4. `store/useSettingsStore.ts`（新）— zustand，经存储抽象读写（非 persist 中间件），含 `hydrated` 标志
5. `store/useChatStore.ts` — 迁出 isDarkMode/toggleTheme，更新引用方（AppHeader 等，实施时 grep）
6. `lib/client-id.ts`（新）+ `hooks/useChat.ts` + `hooks/useModels.ts` — 请求头统一带 X-Client-Id（各一提交）
7. `app/api/chat/route.ts` + `app/api/models/route.ts` — 读头打日志（各一提交）
8. `components/settings/SettingsModal.tsx`（新）+ 四个分区组件 `GeneralSection` / `AccountSection` / `DataSection` / `AgreementSection`（新目录，弹窗被全站共用故入 components/<domain>；样式对齐参考图：圆角弹窗、左侧 pill 高亮导航、行式 label+右置控件、主题三卡片）
9. 删除旧 `components/SettingsModal.tsx`，`components/layout/AppLayout.tsx` 换新挂载 + 水合 + 主题应用（matchMedia 监听）
10. `app/chat/page.tsx` + `app/diagnose/_components/UploadArea.tsx` — pickedModel 从设置初始化（须命中模型列表）、变更回写（各一提交）
11. `scripts/settings-smoke.ts`（新）+ `package.json` — normalize/merge 边界用例，零依赖直跑
12. 删除 `lib/config.ts`（chore）

可选收尾：`app/layout.tsx` 加防闪烁内联脚本（读 v1 key 预设 dark 类；`dangerouslySetInnerHTML` 需 `xss-scan-disable-next-line` 豁免 + why 注释，内容为静态字符串）——默认做，若你觉得多余可砍。

## 验证

1. `npm run lint` && `npm run build` 全绿；`npm run scan:xss` 无 high 命中（豁免行除外）
2. `npm run smoke:settings` 通过
3. 手动：主题三态切换 + 跟随系统实时联动 + 刷新记忆；默认模型刷新不丢；两个浏览器 profile 设置互不串扰；服务端控制台出现 `client=<uuid>` 日志；四个侧栏区逐一过一遍（未实装项均有标注）

## 本次不做（doc 挂账）

- 自定义模型及其密钥安全设计（含 AGENTS.md §7 是否修订，重启时再议）
- generation/systemPrompt 服务端注入、OCR 实装、语言/音色实装、会话持久化