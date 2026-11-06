<!-- markdownlint-disable MD041 -->
<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 1. Framework Facts

- This project runs on Next.js 16 (+ Turbopack) and React 19. Do not apply
  knowledge of earlier Next.js versions.
- Before writing any route handler, server component, or client component,
  read the matching guide under `node_modules/next/dist/docs/`.

## 2. Directory Boundaries

| Path | Holds | Must not hold |
|---|---|---|
| `app/` | Routes, layouts, page composition | Business logic |
| `app/api/*/route.ts` | Input validation + delegation | Logic longer than ~100 lines |
| `components/ui/` | Business-agnostic primitives | Domain knowledge |
| `components/<domain>/` | Components shared across routes | Page-specific markup |
| `lib/` | All non-JSX logic (providers, domain services, prompts) | React components |
| `store/` | Cross-component client UI state | Server-derived data |
| `hooks/` | Hooks reused by more than one component | Single-use helpers |

- A component used by exactly one route lives in `app/<route>/_components/`.
- Components never call external APIs directly; all calls go through `lib/`.

## 3. Type Discipline

- `strict` stays enabled. Do not relax it to work around an error.
- Do not use `any`. Use `unknown` and narrow it.
- Do not use `@ts-ignore`. If genuinely unavoidable, use `@ts-expect-error`
  with a reason on the same line.

## 4. Design Rationale

- Leave a short "why" comment at the point of any non-obvious decision —
  a fallback path, a chosen limit, a workaround.
- Do not comment what the code already says.

## 5. Quality Gate

- A change counts as complete only when both `npm run lint` and
  `npm run build` exit with code 0.
- Never report work as finished without having run both.
- If either fails, fix it first; never run only one and call it done.

## 6. Git Discipline

- One commit per file. Do not bundle unrelated files in a single commit.
- Run `git add` and `git commit` as separate commands. Chaining them on one
  line can make the commit silently fail.
- Commit message format: `<type>: <中文描述>`, where `<type>` is one of
  `feat` | `fix` | `refactor` | `style` | `docs` | `test` | `chore` | `revert`.
  Example: `fix: 修复了模型下拉框写死导致无法切换模型的问题`.
- The description states what changed and why.

## 7. Secrets

- API keys come from environment variables only.
- Never hardcode a key, and never place one in client-side code or storage.
- Keep `.env.example` in sync with the variables the code actually reads.

## 8. Wiring Honesty

- Do not ship UI that presents a capability which is not implemented.
- An unwired control must be hidden or marked as unavailable.

## 9. Protocol Pointer

- Business protocols — diagnosis flow, API contracts, event schemas,
  data models — belong in `doc/`, not here.
- Changing a protocol requires updating the corresponding doc first,
  then the code.
