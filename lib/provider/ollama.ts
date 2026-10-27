/**
 * 本地 ollama Provider 适配
 *
 * 使用 ollama 原生 /api/chat 端点（OpenAI 兼容 /v1 也可用，但原生端点
 * 原生支持 format:"json" 结构化输出，对 harness 更友好）。
 * qwen2.5:7b 为纯文本模型：多模态 content 数组会被收敛为文本标注，
 * 图片真实数据不随请求上传。
 */
import type {
  CompleteOptions,
  LLMProvider,
  ProviderMessage,
  ProviderModel,
} from "./types";

/** ollama 服务地址 */
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
/** 默认回退模型 */
const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b";
/** 单次请求超时（ms） */
const REQUEST_TIMEOUT = 120_000;

/** 将多模态 content 数组收敛为纯文本（图片片段转为文本占位） */
function contentToText(content: ProviderMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) =>
      part.type === "text" ? part.text : "[用户上传了图片附件]"
    )
    .join("\n");
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama" as const;

  isAvailable(): boolean {
    // ollama 不依赖密钥，可用性以运行时请求为准
    return true;
  }

  async listModels(): Promise<ProviderModel[]> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: ProviderModel[] };
      return (data.models ?? []).map((m) => ({ ...m, name: m.name }));
    } catch {
      return [];
    }
  }

  async complete(options: CompleteOptions): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    // 外部信号优先（如路由层 120s 兜底），任一触发即中断
    options.signal?.addEventListener("abort", () => controller.abort());

    const messages: ProviderMessage[] = options.messages.map((m) => ({
      role: m.role,
      content: contentToText(m.content),
    }));

    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model || DEFAULT_OLLAMA_MODEL,
          messages,
          stream: false,
          ...(options.json ? { format: "json" } : {}),
          options: { temperature: 0.7 },
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `ollama 返回错误（HTTP ${res.status}）：${errText || "请确认模型已下载：ollama pull " + (options.model || DEFAULT_OLLAMA_MODEL)}`
        );
      }
      const data = (await res.json()) as {
        message?: { content?: string };
        error?: string;
      };
      if (data.error) throw new Error(`ollama 返回错误：${data.error}`);
      return data.message?.content?.trim() || "";
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 单例导出 */
export const ollamaProvider = new OllamaProvider();
