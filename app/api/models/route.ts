/**
 * GET /api/models
 *
 * 返回三家 Provider（DeepSeek / 智谱 / 自定义 OpenAI 兼容）的真实模型列表与健康状态：
 *   { models, available, status, providers, message }
 * - models：可请求的模型名（首项为该 Provider 默认选中项，已做 name:tag 归一）
 * - status：ok / degraded / unauthorized / unconfigured 聚合结果
 * - providers：每家 Provider 的明细状态与降级原因（前端分组与排障用）
 * 结果带 30s 服务端缓存；GET /api/models?refresh=1 强制重新探测。
 *
 * 历史实现（聚合 ollama 模型列表）已注释保留在文件底部。
 */
import { getModelList } from "@/lib/provider";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const result = await getModelList(force);
  return Response.json(
    {
      models: result.models,
      available: result.available,
      status: result.status,
      providers: result.providers,
      message: result.message,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/* =====================================================================
 * 【历史遗留代码 - 已注释停用，保留原文便于恢复】
 * 原实现（简易重构前 app/api/models/route.ts）：
 * - import { getModelList } from "@/lib/provider";
 * - GET 内直接返回 getModelList() 结果，旧 getModelList 会聚合 ollama
 *   本地模型并探测 localhost:11434（available=false 时提示 ollama 未连接）。
 * 简易重构后 getModelList 仅聚合云端三 provider，不再涉及 ollama。
 * ===================================================================== */
