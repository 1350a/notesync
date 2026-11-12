---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 0389a83fdf2fd477e56fb14bde9a8feb_e77edf90dd0d11f1997d52540024e231
    ReservedCode1: VHBepwLPp52Ol7ka9MXB5WcoQkLwDWRsM0pJaG1nMzyQbFNxWv5C/iZB8cttCVau8xoTMSORQlX3IZI/AdfHyVt61xR4TWTjRqGQHBcDpQMIAusWJaTtckP+Q1WRzt+EOuBtNYUkCtUAKKHYmt6irBpCmCg+P/pC5mi8xW+r6FdEzfn/RbA4geeGQIQ=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 0389a83fdf2fd477e56fb14bde9a8feb_e77edf90dd0d11f1997d52540024e231
    ReservedCode2: VHBepwLPp52Ol7ka9MXB5WcoQkLwDWRsM0pJaG1nMzyQbFNxWv5C/iZB8cttCVau8xoTMSORQlX3IZI/AdfHyVt61xR4TWTjRqGQHBcDpQMIAusWJaTtckP+Q1WRzt+EOuBtNYUkCtUAKKHYmt6irBpCmCg+P/pC5mi8xW+r6FdEzfn/RbA4geeGQIQ=
---

# 用户设置（User Settings）协议

> 状态：P1（抽象层 + 侧栏 UI 落地；generation / systemPrompt / 语言 未接线）｜最后更新：2026-11-10
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
  generation: {                       // 部分接线：thinkingEffort 已实装，其余仍占位
    thinkingEffort?: ThinkingEffort;  // 【已接线 2026-11-12】思考强度档位，默认 'medium'；映射见 §2.1
    temperature?: number;             //   【未接线】钳制 0–2
    maxTokens?: number;               //   【未接线】钳制 1–200_000 整数（防呆上限，实际受上游模型约束）
  };
  ocr: { preferLocal: boolean };      // 【已接线】true=聊天/诊断的图片一律先经浏览器本地 OCR 转文字再发送（隐私/省 token 优先）
  rag: { enabled: boolean };          // 【已接线】true=发送前浏览器本地检索知识库并注入命中片段（见 doc/browser-local-inference.md §6）
}
```

### 2.1 思考强度档位（generation.thinkingEffort，总账 §5「档位映射」的落地）

- 取值：`'off' | 'low' | 'medium' | 'high'`，默认 `'medium'`；聊天输入区右下角选择，持久化到设置。
- 请求链路：设置 → 请求体 `thinkingEffort` → `/api/chat` → `CompleteOptions.thinking` → Provider 请求体。
- Provider 映射（`lib/provider/openaiCompat.ts` 的 `mapThinkingParam`，协议预留的两个参数名）：
  - **zhipu**：`thinking: { type: 'disabled' | 'enabled' }`——GLM 官方口径只有开/关粒度，low/medium/high 统一映射 enabled，选择「关闭」才能真正生效；
  - **deepseek**：`reasoning_effort: 'low' | 'medium' | 'high'`；`off` 不发送参数（关闭语义 = 选用非推理模型，由模型下拉承担）；
  - **custom**：**不发送**——自定义端点对未知字段可能严格校验（与 user 字段开关同口径），思考由端点自身的模型/参数控制。
- 思维链（reasoning_content）是否出现由该档位决定：`off` 时模型不产生思维链，从源头消除其内容泄漏与额外费用（product-vision 理念：思维链是调试设施，不是产品功能）。

### normalize 规则（`lib/settings/types.ts` 纯函数，可冒烟）

| 字段 | 非法输入处理 |
| --- | --- |
| theme | 非 `'light'/'dark'/'system'` → 回落 `'system'` |
| defaultModel | 非字符串 → `''`；超 200 字符截断 |
| systemPrompt | 非字符串 → `''`；超 8000 字符截断 |
| generation.temperature | 非有限数字 → 丢弃；越界 → 钳制到 0–2 |
| generation.maxTokens | 非有限数字 / ≤0 → 丢弃；向下取整并钳制到 1–200_000 |
| ocr.preferLocal | 严格 `=== true` 才为 true |
| rag.enabled | 严格 `=== true` 才为 true |
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

### 4.1 上游终端用户标识（请求体 user 字段）

与 `X-Client-Id` 是两回事，不得混用（safety-protocol.md §6）：

- 字段位置：`/api/chat` 请求体顶层 `user` 字段（OpenAI 兼容规范），随 Provider 请求体转发；
- 取值：纯随机 UUID v4，localStorage key `notesync-user-id`，绝不含设备名/主机名/用户名（该值会到达上游厂商侧）；
- 稳定性：同设备多次请求保持一致；隐私模式退化同 `getClientId`；
- 可重置：设置页「数据」分区提供「重置设备标识」入口（合规可撤销要求），重置后下次请求生效；
- 携带开关：环境变量 `USER_FIELD_ENABLED`（默认开启，置 `0` 关闭）——部分自定义 OpenAI 兼容端点对未知字段严格校验，关掉即不随 Provider 请求上行。

## 5. UI 分区与实装状态（`components/settings/`）

弹窗为左侧固定导航 + 右侧内容区（参考系统设置通用布局），全站共用，挂载于 `AppLayout`。

| 分区 | 状态 | 内容 |
| --- | --- | --- |
| 通用设置 | **实装** | 主题三选卡片（浅色/深色/跟随系统）；默认模型下拉（选项来自 GET /api/models，含"跟随后端推荐"）；语言、朗读音色两行禁用 + "未实装"标注 |
| 本地能力 | **实装** | 按任务四行（见 doc/browser-local-inference.md §7）：图片处理（OCR，写 `ocr.preferLocal`，自通用设置迁入）、知识检索（开关写 `rag.enabled` + 引擎/资产状态展示）、本地引擎（预加载/重试 + 进度）、本地对话（禁用 + "未实装"标注，v2 小 LLM） |
| 账号管理 | 占位 | 文案说明：无账号体系，配置仅存本浏览器 |
| 数据管理 | **实装** | 恢复默认设置（storage.clear）；重置设备标识（`resetUserId()`，仅清 `notesync-user-id`，不动设置，见 §4.1）；清除全部本地数据（遍历清除 `notesync` 前缀 key 后刷新，含旧版 `notesync_config` 与客户端标识） |
| 服务协议 | 静态 | 本地存储声明、无遥测、密钥仅环境变量、数据由所配模型服务商处理 |

> 口径变更（2026-11-11 合并 `beta/browser-ocr` 时归并）：原「图片处理」行已从通用设置
> 迁入「本地能力」分区，与知识检索 / 本地引擎 / 本地对话并列成四行，全站只有一处该开关
> （`components/settings/LocalCapabilitySection.tsx`）。本表按**代码现状**记录，
> 勿据旧表述判断 UI 位置。

主题消费收口：`AppLayout` 负责水合 + 把 `theme` 应用到 `documentElement`（'system' 时订阅 matchMedia 变化实时联动）；顶栏按钮循环切换 浅色→深色→跟随系统。根布局另有防闪烁内联脚本（静态常量，见 `lib/settings/anti-flash.ts`）。

## 6. 待实现（挂账）

- generation / systemPrompt 服务端注入：扩展 `ChatRequestBody` + `/api/chat` 校验读取（参数经 `CompleteOptions` 透传 provider）。
- OCR `preferLocal` 已接线（2026-11-10，语义见 doc/browser-local-ocr.md §6）；云 OCR 选项仍挂账（设备边界规则：数据跨出设备必须显式同意）。
- RAG `rag.enabled` 已接线（2026-11-10，语义见 doc/browser-local-inference.md §6）；查询侧触发阈值 `RAG_MIN_QUERY_CHARS = 8` 已接线（2026-11-12，见同文档 §5.4）；云端 embedding 与对话本地档位挂账（同文档 §8）。
- 语言（i18n）、朗读音色（TTS）实装。
- 自定义模型 + 客户端密钥安全设计（重启时议 `AGENTS.md` §7 是否修订）。
- 会话持久化 /api/sessions（复用 X-Client-Id）。
- ~~CSP 响应头~~ **已落地（2026-11-10 复核移出挂账）**：基础版 CSP 由 `next.config.ts`
  的 `headers()` 全站下发，`scripts/xss-scan.ts` 的 `csp.missing` 不再触发；指令明细与
  剩余项（nonce/hash 严格 script-src、Trusted Types、上报端点）见
  doc/browser-local-inference.md §9。
*（内容由AI生成，仅供参考）*
