/**
 * DeepSeek API Provider 适配
 *
 * OpenAI 兼容端点 /chat/completions，Bearer 鉴权。
 * 支持多模态 content 数组（image_url 真实图片上传）与
 * response_format:"json_object" 结构化输出。
 */
import type {
  CompleteOptions,
  LLMProvider,
  ProviderMessage,
  ProviderModel,
} from "./types";

/** DeepSeek API Key（.env.local 中配置） */
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
/** DeepSeek OpenAI 兼容端点 */
const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
/** DeepSeek 官方模型列表 */
export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"];
/** 单次请求超时（ms） */
const REQUEST_TIMEOUT = 120_000;

/** 配置了 key 才认为 DeepSeek 可用 */
export function deepseekAvailable(): boolean {
  return Boolean(DEEPSEEK_API_KEY);
}

export class DeepSeekProvider implements LLMProvider {
  readonly name = "deepseek" as const;

  isAvailable(): boolean {
    return deepseekAvailable();
  }

  async listModels(): Promise<ProviderModel[]> {
    return DEEPSEEK_MODELS.map((name) => ({
      name,
      model: name,
      modified_at: new Date().toISOString(),
      size: 0,
      digest: "",
      details: { family: "deepseek" },
    }));
  }

  async complete(options: CompleteOptions): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    options.signal?.addEventListener("abort", () => controller.abort());

    try {
      const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages as ProviderMessage[],
          stream: false,
          ...(options.json
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `DeepSeek 返回错误（HTTP ${res.status}）：${errText || "请检查 API Key 是否正确、余额是否充足。"}`
        );
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      if (data.error?.message) {
        throw new Error(`DeepSeek 返回错误：${data.error.message}`);
      }
      return data.choices?.[0]?.message?.content?.trim() || "";
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 流式补全：解析 OpenAI SSE（data: {...} 增量），逐段 yield 文本增量。
   * DeepSeek 端点支持 stream: true 与 response_format 组合。
   */
  async *streamComplete(options: CompleteOptions): AsyncGenerator<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    options.signal?.addEventListener("abort", () => controller.abort());

    try {
      const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages as ProviderMessage[],
          stream: true,
          ...(options.json
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `DeepSeek 返回错误（HTTP ${res.status}）：${errText || "请检查 API Key 是否正确、余额是否充足。"}`
        );
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("DeepSeek 流式响应缺少 body");

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") return;
          try {
            const chunk = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) yield delta;
          } catch {
            // 忽略无法解析的数据行
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 单例导出 */
export const deepseekProvider = new DeepSeekProvider();
