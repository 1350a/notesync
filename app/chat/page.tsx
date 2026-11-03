"use client";

/**
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：app/chat/page.tsx
 * 说明：旧版完整多轮聊天页（Sidebar / ChatMessage / ChatInput、本地会话存储、
 *   SSE 流式消费、DEFAULT_MODEL 兜底等约 393 行实现）。简易重构后首页
 *   app/page.tsx 已内置简易聊天，本路由停用并保留占位。
 * 恢复：git checkout -- app/chat/page.tsx（并配套恢复 components/、
 *   lib/harness、lib/agent、lib/rag、lib/ocr.ts、lib/pdf.ts、lib/types.ts、lib/storage.ts）。
 */
export default function ChatPagePlaceholder() {
  return (
    <main
      className="flex min-h-screen items-center justify-center p-8"
      style={{ backgroundColor: "var(--bg)", color: "var(--text)" }}
    >
      <div className="text-center">
        <h1 className="text-base font-semibold">聊天页已停用</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          简易聊天已迁移至首页（/）。如需恢复旧版多轮对话页，请按 git 历史还原本路由及相关旧组件。
        </p>
      </div>
    </main>
  );
}
