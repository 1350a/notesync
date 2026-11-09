# 用户设置（User Settings）协议

> 状态：P1（抽象层 + 侧栏 UI 落地；generation / systemPrompt / OCR / 语言 未接线）｜最后更新：2026-11-09
> 对应代码：`lib/settings/`、`store/useSettingsStore.ts`、`components/settings/`、`lib/client-id.ts`、`components/layout/AppLayout.tsx`（水合与主题收口）

本文件是用户设置的**唯一事实来源**。修改协议必须先改本文件，再改代码（见 `AGENTS.md` §9）。

---

## 1. 设计原则

- **无登录系统、无数据库**：配置一律存浏览器 localStorage，服务端零持久化、零设置类 API。
- **抽象优先**：消费方（store / 组件）只依赖 `SettingsStorage` 接口；当前实现为 localStorage，将来若引入服务端存储仅替换实现，不改消费方。
- **诚实接线**（`AGENTS.md` §8）：未实装能力不出现可交互控件，保留的占位行必须禁用并标注"未实装"。
- **密钥边界**：API Key 仍只来自服务端环境变量（`AGENTS.md` §7），不进客户端；客户端配置密钥的设计随"自定义模型"功能另议。

## 2. 设置模式（UserSettings）

```ts
interface UserSettings {
  theme: 'light' | 'dark' | 'system'; // 默认 'system'（跟随系统，matchMedia 实时联动）
  defaultModel: string;               // 默认模型名；'' = 跟随后端推荐（/api/models 首项）
  language: 'system';                 // 【未接线】界面语言，当前仅占位
  systemPrompt: string;               // 【未接线】自定义系统提示词，无 UI，服务端注入待下一轮
  generation: {                       // 【未接线】生成参数，缺省项表示跟随 provider 默认
    temperature?: number;             //   钳制 0–2
    maxTokens?: number;               //   钳制 1–200_000 整数（防呆上限，实际受上游模型约束）
  };
  ocr: { preferLocal: boolean };      // 【未接线】是否优先本地 OCR（业务逻辑未实装）
}
```

### normalize 规则（`lib/settings/types.ts` 纯函数，可冒烟）

| 字段 | 非法输入处理 |
| --- | --- |
| theme | 非 `'light'/'dark'/'system'` → 回落 `'system'` |
| defaultModel | 非字符串 → `''`；超 200 字符截断 |
| systemPrompt | 非字符串 → `''`；超 8000 字符截断 |
| generation.temperature | 非有限数字 → 丢弃；越界 → 钳制到 0–2 |
| generation.maxTokens | 非有限数字 / ≤0 → 丢弃；向下取整并钳制到 1–200_000 |
| ocr.preferLocal | 严格 `=== true` 才为 true |
| 未知字段 | 一律丢弃（前向兼容：新版本读旧数据补默认，旧版本读新数据不崩） |

## 3. 存储接口（SettingsStorage）

```ts
interface SettingsStorage {
  load(): UserSettings;        // 缺失/损坏一律回落 DEFAULT_SETTINGS，不抛错
  save(settings: UserSettings): void; // 尽力而为：配额满/隐私模式失败仅 console.warn，不影响内存态
  clear(): void;
}
```

- **localStorage 实现**（`createLocalStorageSettingsStorage`）：key 为 `notesync-settings.v1`，内容 `{ version: 1, ...settings }`。版本号仅作标识，当前合并策略统一走 normalize（未知字段丢弃 + 默认合并）。
- **内存实现**（`createMemorySettingsStorage`）：冒烟测试与将来 SSR/服务端场景用。
- `DEFAULT_SETTINGS` 为共享只读约定；需要独立副本用 `cloneDefaults()`（嵌套对象深拷贝），消费方不得直接修改。

## 4. 客户端身份（X-Client-Id）

无登录体系下服务端区分请求来源的匿名标识（user_id 替代）：

- `lib/client-id.ts`：UUID 存 localStorage key `notesync-client-id`，首次访问生成；非 secure context（如局域网 http）无 `crypto.randomUUID` 时用 `getRandomValues` 拼 UUID v4。
- 所有 `/api/*` 请求带 `X-Client-Id` 请求头；SSR 环境取不到则不带该头。
- **服务端仅打日志**（`[chat] client=<id>`），不落盘、不参与路由——服务端保持逐请求无状态，少量并发天然安全。
- 为将来会话存储（/api/sessions）、按客户端配额预留钩子。

## 5. UI 分区与实装状态（`components/settings/`）

弹窗为左侧固定导航 + 右侧内容区（参考系统设置通用布局），全站共用，挂载于 `AppLayout`。

| 分区 | 状态 | 内容 |
| --- | --- | --- |
| 通用设置 | **实装** | 主题三选卡片（浅色/深色/跟随系统）；默认模型下拉（选项来自 GET /api/models，含"跟随后端推荐"）；语言、朗读音色两行禁用 + "未实装"标注 |
| 账号管理 | 占位 | 文案说明：无账号体系，配置仅存本浏览器 |
| 数据管理 | **实装** | 恢复默认设置（storage.clear）；清除全部本地数据（遍历清除 `notesync` 前缀 key 后刷新，含旧版 `notesync_config` 与客户端标识） |
| 服务协议 | 静态 | 本地存储声明、无遥测、密钥仅环境变量、数据由所配模型服务商处理 |

主题消费收口：`AppLayout` 负责水合 + 把 `theme` 应用到 `documentElement`（'system' 时订阅 matchMedia 变化实时联动）；顶栏按钮循环切换 浅色→深色→跟随系统。根布局另有防闪烁内联脚本（静态常量，见 `lib/settings/anti-flash.ts`）。

## 6. 待实现（挂账）

- generation / systemPrompt 服务端注入：扩展 `ChatRequestBody` + `/api/chat` 校验读取（参数经 `CompleteOptions` 透传 provider）。
- OCR `preferLocal` 实装（对应 `lib/ocr.ts` 停用代码的恢复）。
- 语言（i18n）、朗读音色（TTS）实装。
- 自定义模型 + 客户端密钥安全设计（重启时议 `AGENTS.md` §7 是否修订）。
- 会话持久化 /api/sessions（复用 X-Client-Id）。
- CSP 响应头（XSS/密钥加固的后续项，见 scripts/xss-scan.ts 的 `csp.missing`）。
