import type { ModelsResponse, OllamaModel } from "@/lib/types";

/** ollama 服务地址 */
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

/**
 * GET /api/models
 * 拉取本地 ollama 模型列表（ollama /api/tags），供前端切换模型。
 * ollama 未运行时返回 available=false 与友好提示，不抛错。
 */
export async function GET() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!res.ok) {
      return Response.json(
        {
          models: [],
          available: false,
          message: `ollama 服务响应异常（HTTP ${res.status}），请检查服务状态。`,
        } satisfies ModelsResponse,
        { status: 200 }
      );
    }

    const data = (await res.json()) as { models?: OllamaModel[] };
    const models = (data.models ?? []).map((m) => ({
      ...m,
      name: m.name,
    }));

    return Response.json({
      models,
      available: true,
    } satisfies ModelsResponse);
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "连接 ollama 超时，请确认服务已启动（ollama serve）。"
        : "无法连接本地 ollama 服务，请确认已安装并运行 ollama（默认端口 11434）。";
    return Response.json(
      {
        models: [],
        available: false,
        message: msg,
      } satisfies ModelsResponse,
      { status: 200 }
    );
  }
}
