import type { ModelsResponse } from "@/lib/types";
import { getModelList } from "@/lib/provider";

/**
 * GET /api/models
 * 薄路由：模型列表统一由 provider 聚合层返回。
 * - 有 DeepSeek key：返回 DeepSeek 云端模型（deepseek-flash / deepseek-v4-pro），
 *   ollama 可用时追加本地模型
 * - 无 key：返回本地 ollama 模型列表；ollama 未运行时返回 available=false 与友好提示
 */
export async function GET() {
  const result = await getModelList();
  return Response.json({
    models: result.models,
    available: result.available,
    message: result.message,
  } satisfies ModelsResponse);
}
