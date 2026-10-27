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
}

/** 单例导出 */
export const deepseekProvider = new DeepSeekProvider();
