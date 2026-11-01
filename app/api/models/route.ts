/**
 * GET /api/models
 * 简易重构版：返回三选一（DEEPSEEK / ZHIPU / CUSTOM）可用 Provider 的模型列表。
 * - 配置了 key 的 provider 模型在前
 * - 无任何 key：返回 available=false 与明确的配置缺失提示
 * 与 .env.example 一致，不再检测本地 ollama。
 *
 * 历史实现（聚合 ollama 模型列表）已注释保留在文件底部。
 */
import { getModelList } from "@/lib/provider";

export async function GET() {
  const result = await getModelList();
  return Response.json({
    models: result.models,
    available: result.available,
    message: result.message,
  });
}

/* =====================================================================
 * 【历史遗留代码 - 已注释停用，保留原文便于恢复】
 * 原实现（简易重构前 app/api/models/route.ts）：
 * - import { getModelList } from "@/lib/provider";
 * - GET 内直接返回 getModelList() 结果，旧 getModelList 会聚合 ollama
 *   本地模型并探测 localhost:11434（available=false 时提示 ollama 未连接）。
 * 简易重构后 getModelList 仅聚合云端三 provider，不再涉及 ollama。
 * ===================================================================== */
