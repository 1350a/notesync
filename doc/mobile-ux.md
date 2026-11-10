# 移动端体验（Mobile UX）协议

状态：实施中。基线分支 `feat/mobile-ux`（基于 `beta/browser-ocr` 与 `feat/local-page-on-planb` 的共同祖先 e46268a）。
本文记录移动端适配的行为契约；代码改动以本文件为先行依据。

## 1. 设计原则

- 桌面现状不动，移动端（`<768px` 或 pointer: coarse）按需切换呈现方式。
- 视口单位一律用 `dvh` 系（`h-dvh`/`min-h-dvh`），不用 `vh`/`h-screen`：移动浏览器动态工具栏下 100vh ≠ 可视高度。
- 触屏判定优先用 `pointer: coarse` 能力查询而非宽度断点：宽度≠触屏。

## 2. 侧栏开合契约

状态来源：`useChatStore.isSidebarOpen`。

- **默认值：收起**。首帧（SSR 与客户端首次渲染）一律收起，两帧一致，无 hydration 闪烁。
- **持久化**：`lib/ui/storage.ts`（localStorage key `notesync-ui.v1`，只存 `{ sidebarOpen }`）。
  mount 后恢复上次状态（走既有 300ms 过渡动画，不闪变）。读写失败静默降级为默认值，不阻塞启动。
- **记忆粒度：单 flag**（桌面与移动共用）。移动端展开为覆盖式抽屉、不挤占内容，因此单 flag 无害。
- **呈现方式分端**：
  - `≥768px`：维持现状挤占式（w-64 / w-0 过渡）。
  - `<768px`：overlay 抽屉（`components/ui/drawer.tsx`，`swipeDirection="left"` 左侧贴边、
    宽度 min(75%, 16rem)、遮罩点击关闭、支持手势滑出）。
- **路由切换自动收起**：仅移动端在 pathname 变化时收起；桌面保持开合状态跨路由不变。
- **结构约束（关键）**：AppLayout 必须由 `app/(main)/layout.tsx` 路由组承载，
  不得在各 page 内自行包裹——页面内包裹会使布局随导航重挂载，
  造成抽屉重开、双 portal 残留与 hydrateUI 重复执行（实测复现过）。
- **持久化粒度：单 flag**（桌面与移动共用，浏览器本地存储，无用户系统）。

## 3. 聊天自动吸底契约（用户操作优先）

跟随生效条件（两者同时满足才滚动）：

1. `atBottom`：距底 ≤ 80px；
2. `!userInterrupted`：用户未主动上滚。

- **用户操作判定（方向增量法）**：监听滚动容器的 scroll 事件，滚动位置较上次**向上**移动
  （差值 > 4px）即判为用户操作（滚轮/滚动条/键盘/触摸全覆盖）；程序吸底只向下移动，方向可区分，不会误判。
- 用户滚回距底 ≤ 16px（近底部）时，`userInterrupted` 自动复位，跟随恢复。
- 流式期间滚动用 `behavior: 'auto'`（即时），不用 smooth（连续 smooth 动画观感发飘）。
- **发送例外**：挂账，本轮不实装（发送时无条件吸底一次，接入时间待定）。
- **回到底部按钮**：`userInterrupted` 且不在底部时，在输入区上方显示「↓ 回到底部」悬浮按钮；
  点击平滑滚至底部并恢复跟随。

## 4. 触控与输入契约

- 附件删除按钮常显（hover 仅作视觉强调），触屏可见可点。
- `pointer: coarse` 下 Enter 键不发送、允许换行，发送仅靠按钮；桌面维持 Enter 直发。
- 触屏（coarse）下图标按钮热区提升至 44px（`touch:` variant，globals.css 定义
  `@custom-variant touch (@media (pointer: coarse))`）；桌面尺寸不变。
- 回车提示跟随 Enter 实际行为：桌面 `enterKeyHint="send"`（键盘右下角显示"发送"）、
  占位符含"回车发送"；coarse 下 Enter 已放开给输入法换行（本节第二条），故
  `enterKeyHint="enter"`（显示"换行"）、占位符省略"回车发送"——发送仅靠按钮。
- 可聚焦文本控件（textarea / 文本 input）触屏字号 16px（`touch:text-base`）：
  iOS Safari 对 computed font-size < 16px 的输入框聚焦时会强制放大页面。
  select 与 file input 不触发缩放，disabled 输入框不可聚焦，均无需处理。

## 5. 内容渲染契约

- `.markdown-body table`：`display: block; overflow-x: auto`，宽表格横向滚动，不撑破视口。
- `.markdown-body .katex-display`：`overflow-x: auto`，长公式横向滚动。

## 6. 视口与键盘

- `app/layout.tsx` 显式导出 `viewport: { width: 'device-width', initialScale: 1, interactiveWidget: 'resizes-content' }`
  （Chrome Android 108+ 键盘弹起时压缩布局视口，输入区不被遮挡；iOS Safari 由 dvh 语义覆盖）。

## 7. 页面级适配

- `p-8` → `px-4 py-6 md:p-8`（diagnose / local / ocr）；diagnose 标题区 `mb-10` → `mb-6 md:mb-10`。
- UploadArea 拖放区 `p-6 md:p-12`。
- SettingsModal：`<md` 铺满视口成全屏 sheet（`max-md:h-dvh max-md:rounded-none`），桌面维持 `h-[560px] max-h-[85dvh]`。

## 8. 实装状态

| 契约 | 状态 |
|---|---|
| §2 侧栏契约 | 已实装 |
| §3 吸底契约 | 已实装（发送例外挂账） |
| §4 触控契约 | 已实装 |
| §5 渲染契约 | 已实装 |
| §6 视口契约 | 已实装 |
| §7 页面适配 | 已实装 |
