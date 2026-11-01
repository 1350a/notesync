/**
 * 简易重构版：diagnose 路由已注释停用。
 * 说明：外壳重写为简易聊天首页后，放弃原“上传诊断”入口，
 * 本路由页面/跳转全部停用（不删除），旧代码保留在底部注释块便于恢复。
 */
export default function DiagnosePage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: "var(--bg)", color: "var(--text-muted)" }}
    >
      <p className="text-center text-sm">
        该功能已停用：简易版重构后请使用首页聊天入口。
      </p>
    </div>
  );
}

/* =====================================================================
 * 【历史遗留代码 - 已注释停用，保留原文便于恢复】
 * 原实现（简易重构前 app/diagnose/page.tsx）：
 * 'use client'
 * 客户端组件，上传图片/PDF 后调用 /api/chat 的 harness 诊断流程，
 * 包含：文件上传框、主题说明、结果渲染（追问卡片 / 诊断正文 / 思考过程）。
 * 简易重构后整体停用，首页改为简易聊天界面。
 * 如需恢复，请还原此文件为旧版并配合 /api/chat 旧 harness 链路使用。
 * ===================================================================== */
