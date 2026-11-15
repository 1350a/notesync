---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 0389a83fdf2fd477e56fb14bde9a8feb_eb9d4eaedf3211f19919525400638852
    ReservedCode1: cGE71YzacdIov+1eo3JHJPLbnyQ8uST5QkNn7z0SZkvE8gtGQ8rZTZteQNfIObQHsIKjSb1eJxuNxREvxWMzwWFQl4xungJ1U85bMfGkcU/o1xSFuMFv65SqWEz1OiDjn4xbticFwJC5waau3WzAe2M7O7GPwGCcZIACCUwg3ehJsbn+t8NFr5gHcAQ=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 0389a83fdf2fd477e56fb14bde9a8feb_eb9d4eaedf3211f19919525400638852
    ReservedCode2: cGE71YzacdIov+1eo3JHJPLbnyQ8uST5QkNn7z0SZkvE8gtGQ8rZTZteQNfIObQHsIKjSb1eJxuNxREvxWMzwWFQl4xungJ1U85bMfGkcU/o1xSFuMFv65SqWEz1OiDjn4xbticFwJC5waau3WzAe2M7O7GPwGCcZIACCUwg3ehJsbn+t8NFr5gHcAQ=
---

# Git 提交规范（v1）

> **状态：已定稿并生效**（2026-11-13 补齐）。
> 本文把 `AGENTS.md` §6（Git Discipline）里散落的纪律展开为可执行细则，覆盖提交信息格式、类型前缀、scope 约定、单次提交粒度、正文与 footer 写法、禁提交项。
> 与 `AGENTS.md` §5（Quality Gate）的关系：门禁先行，提交在后 —— 任何一次 `git commit` 之前，`npx tsc --noEmit`、`npm run lint`、`npm run build` 必须已全绿；测试改动须附 `npx vitest run` 结果。
>
> **约束强度**：分级口径见 `product-vision.md` §0。**§1 类型前缀、§5 禁提交项属硬约束**（做错即缺陷，需 rebase 修正）；**§3 scope、§4 正文与 footer 为「方向 D」级**，可随仓库演进微调。

## 1. 提交信息格式与类型前缀

单行标题格式：

```
<type>(<scope>): <中文描述>
```

`<scope>` 可省略（省略时为 `<type>: <中文描述>`）。`<type>` 只允许下列八种，与仓库既有历史一致：

| type | 用途 | 典型场景 |
|---|---|---|
| `feat` | 新增用户可见能力 | 新页面、新交互、新检索维度、新 Provider 能力 |
| `fix` | 修复已存在的行为缺陷 | 空转、错位、状态未复位、断言失效 |
| `refactor` | 不改变外部行为的结构调整 | 拆函数、抽常量、换实现路径 |
| `style` | 纯格式与样式调整 | 缩进、引号、Tailwind 类名顺序、仅视觉的样式改动 |
| `docs` | 仅文档变更 | `doc/`、`README.md`、`AGENTS.md`、注释性说明 |
| `test` | 仅测试变更 | 补用例、修断言、调整夹具 |
| `chore` | 构建、依赖、脚本、杂务 | 依赖升降、`package.json` 脚本、删空壳文件、配置项 |
| `revert` | 回滚既有提交 | 需在正文注明被回滚的 commit hash 与原因 |

- **描述用中文**，一句话说清「改了什么、为什么」，不带句末标点，不超过 50 字。
- 不写「update」「修改一下」「若干优化」这类无信息量描述；不写未经验证的结论（如「已修复全部问题」）。
- 同时命中多个 type 时，取**主要影响面**：改代码顺带改注释仍记 `feat`/`fix`/`refactor`；只有文档实质变更才记 `docs`。

## 2. 提交粒度

- **默认一文件一提交**（`AGENTS.md` §6）。不要在一个提交里塞进互不相关的文件。
- **允许合并的例外**：同一个逻辑变更的「代码 + 测试 + 文档」三件套可合成一次提交，前提是拆开后任一提交都无法单独通过门禁或单独成立。例：删一个常量时，同时改引用它的测试与指向它的文档，属一次逻辑变更。
- **必须拆开的信号**：出现两个及以上互不依赖的意图（如「补规范」与「清死代码」）；或一次提交的标题里被迫出现「并」字串联两件不相干的事。
- 中间态不提交：验证性脚本、临时清单、跑一半的改动留在工作区或用 `git stash`，不要用「wip」「临时提交」凑历史。
- 提交前先看 `git status` 与 `git diff --cached`，确认暂存区里只有本次意图涉及的文件；`git add` 与 `git commit` 分两行执行，不链式调用（`AGENTS.md` §6）。

## 3. scope 约定

scope 取**改动落点所在目录或领域**，小写，不带路径分隔符。常用值：

| scope | 落点 |
|---|---|
| `provider` | `lib/provider/` 下的模型适配与白名单 |
| `local` | `lib/local/` 浏览器端推理与 OCR |
| `rag` | 检索增强相关模块 |
| `api` | `app/api/*/route.ts` |
| `ui` | `components/ui/` 与通用视觉层 |
| `store` | `store/` 客户端状态 |
| `hooks` | `hooks/` |
| `chat` / `diagnose` / `settings` | 对应路由域 |
| `doc` | `doc/` 内单篇文档体系 |
| `deps` | 依赖与构建配置 |

- 改动横跨三个及以上 scope 时，省略 scope，不要硬凑。
- 新增 scope 前先看 `git log --oneline` 是否已有同义写法，优先复用历史用词。

## 4. 正文与 footer

- **标题行之后空一行**再写正文；标题已能说清时可以不写正文，不强制凑字数。
- 正文写**动机与影响**，不逐行复述 diff：
  - 为什么改（缺陷现象、文档与实现的偏离、依赖变化）；
  - 改完的边界（影响哪些路由、哪些调用方、有无兼容处理）；
  - 验证方式（跑了哪几条命令、关键结果）。
- 正文按行折行，单行不超过 72 字符，便于 `git log` 阅读。
- **footer** 在正文后空一行，按需使用下列关键字：

| footer | 语义 | 示例 |
|---|---|---|
| `Refs:` | 关联议题、文档章节或前序提交 | `Refs: doc/tool-protocol.md §3` |
| `Closes:` | 关闭的议题编号 | `Closes: #42` |
| `BREAKING CHANGE:` | 破坏性变更，必须说明迁移方式 | `BREAKING CHANGE: 模型名白名单移除 deepseek-v4-flash，需改用 deepseek-flash` |
| `Co-authored-by:` | 协作署名 | `Co-authored-by: xxx <mail>` |

- 破坏性变更必须在 footer 明写，不能只靠标题暗示。

## 5. 禁提交项

以下内容不进版本库，也不得以任何形式被 `git add` 进提交：

| 类别 | 具体项 |
|---|---|
| 真实密钥与环境 | `.env`、`.env.local`、`.env.*.local` 及任何含 Key/Token 的文件；**`.env.example` 作为模板必须提交，且只放占位值** |
| 构建产物 | `.next/`、`out/`、`dist/`、`build/`、`*.tsbuildinfo` |
| 依赖目录 | `node_modules/`、`.pnpm-store/` |
| 临时与日志 | `*.log`、`.vitest-*`、临时脚本与清单、`scratch/`、`tmp/` 类目录 |
| 系统与编辑器垃圾 | `.DS_Store`、`Thumbs.db`、`.idea/`（`.vscode/` 仅在团队显式约定时提交） |
| 大体积二进制 | 任何非必要入库的音频、视频、模型权重、压缩包 |

- 提交前若 `git status` 出现上述项，先确认 `.gitignore` 是否漏项；补 `.gitignore` 属 `chore` 提交。
- 已经误提交的密钥：视为已泄露，先轮换 Key，再清理历史，不能只在后续提交里删除。

## 6. 提交前检查清单

1. `git status` 与 `git diff --cached` 已看，暂存文件与本次意图一致。
2. `npx tsc --noEmit`、`npm run lint`、`npm run build` 全部退出码 0；涉及测试的改动另跑 `npx vitest run`。
3. 标题符合 `<type>(<scope>): <中文描述>`，type 在 §1 白名单内。
4. 没有 §5 列出的禁提交项混入。
5. 破坏性变更已在 footer 标注；文档与代码在同一次逻辑变更内保持一致。
*（内容由AI生成，仅供参考）*
