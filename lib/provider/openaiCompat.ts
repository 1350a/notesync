/**
 * OpenAI 兼容 Provider 公共基类
 *
 * DeepSeek / 智谱 AI / 自定义模型均遵循 OpenAI Chat Completion 协议：
 * - 端点：{baseUrl}/chat/completions
 * - 鉴权：Authorization: Bearer <apiKey>
 * - 请求/响应结构与 OpenAI 一致（含 SSE 流式、response_format json_object）
 *
 * 子类只需提供 name、apiKey、baseUrl、默认模型列表与展示名。
 *
 * 思考过程（reasoning）支持：
 * - DeepSeek R1 系 / 部分推理模型会在响应中返回 reasoning_content
 *   （非流式 message.reasoning_content，流式 delta.reasoning_content）；
 * - completeDetailed / streamDetailed 透出该字段供前端展示；
 * - complete / streamComplete 保持原签名（仅取 content），内部同样解析 reasoning。
 */
import type {
  CompleteDetailedResult,
  CompleteOptions,
  LLMProvider,
  ProviderMessage,
  ProviderModel,
  StreamDelta,
} from './types.ts';

/** 单次请求超时（ms） */
const REQUEST_TIMEOUT = 120_000;

export interface OpenAICompatConfig {
  /** Provider 名称（deepseek | zhipu | custom） */
  name: 'deepseek' | 'zhipu' | 'custom';
  /** API Key（为空视为不可用） */
  apiKey: string;
  /** OpenAI 兼容 Base URL（不含 /chat/completions） */
  baseUrl: string;
  /** 默认模型列表（listModels 返回） */
  defaultModels: string[];
  /** 环境变量配置的首选模型（可选，并入列表并参与归属判断） */
  envModel?: string;
  /** 错误信息与展示用名（如 "DeepSeek"、"智谱 AI"） */
  displayName: string;
  /** 是否允许多模态 image_url 透传（默认 true） */
  allowImages?: boolean;
}

export class OpenAICompatProvider implements LLMProvider {
  readonly name: 'deepseek' | 'zhipu' | 'custom';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModels: string[];
  private readonly envModel?: string;
  private readonly displayName: string;
  private readonly allowImages: boolean;

  constructor(config: OpenAICompatConfig) {
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.defaultModels = config.defaultModels;
    this.envModel = config.envModel;
    this.displayName = config.displayName;
    this.allowImages = config.allowImages ?? true;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.baseUrl);
  }

  /** 模型列表：默认官方模型 + 环境变量配置模型（去重） */
  listModels(): Promise<ProviderModel[]> {
    const names = [...this.defaultModels];
    if (this.envModel && !names.includes(this.envModel)) names.push(this.envModel);
    return Promise.resolve(
      names.map((name) => ({
        name,
        model: name,
        modified_at: new Date().toISOString(),
        size: 0,
        digest: '',
        details: { family: this.name },
      }))
    );
  }

  /** 判断模型名是否属于本 Provider（供路由按模型名归属） */
  ownsModel(model: string): boolean {
    return this.defaultModels.includes(model) || model === this.envModel;
  }

  private buildBody(options: CompleteOptions, stream: boolean): string {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages as ProviderMessage[],
      stream,
    };
    if (options.json) body.response_format = { type: 'json_object' };
    if (options.tools) {
      body.tools = options.tools;
      if (options.toolChoice) body.tool_choice = options.toolChoice;
    }
    if (!this.allowImages) {
      body.messages = (options.messages as ProviderMessage[]).map((m) => ({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content.map((part) => (part.type === 'text' ? part.text : '[图片附件]')).join('\n'),
      }));
    }
    return JSON.stringify(body);
  }

  private async post(options: CompleteOptions, stream: boolean): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    options.signal?.addEventListener('abort', () => controller.abort());
    try {
      return await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: this.buildBody(options, stream),
        signal: controller.signal,
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private errorMessage(status: number, errText: string): string {
    return `${this.displayName} 返回错误（HTTP ${status}）：${errText || '请检查 API Key 是否正确、余额是否充足。'}`;
  }

  /** 解析响应 message/delta 中的内容与思考过程（兼容 reasoning_content / reasoning） */
  private parseReasoning(
    m: { content?: string; reasoning_content?: string; reasoning?: string } | undefined
  ): { content: string; reasoning?: string } {
    const content = m?.content?.trim() || '';
    const reasoning = (m?.reasoning_content ?? m?.reasoning)?.trim() || '';
    return { content, reasoning: reasoning || undefined };
  }

  async complete(options: CompleteOptions): Promise<string> {
    const r = await this.completeRaw(options);
    return r.content;
  }

  /** 详细补全：透出 reasoning 思考过程（供 /api/chat 透传） */
  async completeDetailed(options: CompleteOptions): Promise<CompleteDetailedResult> {
    return this.completeRaw(options);
  }

  private async completeRaw(options: CompleteOptions): Promise<CompleteDetailedResult> {
    const res = await this.post(options, false);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(this.errorMessage(res.status, errText));
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string;
          reasoning_content?: string;
          reasoning?: string;
          tool_calls?: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }[];
      error?: { message?: string };
    };
    if (data.error?.message) {
      throw new Error(`${this.displayName} 返回错误：${data.error.message}`);
    }
    const choice = data.choices?.[0];
    const parsed = this.parseReasoning(choice?.message);
    return {
      ...parsed,
      toolCalls: choice?.message?.tool_calls,
      finishReason: choice?.finish_reason,
    };
  }

  /**
   * 流式补全：解析 OpenAI SSE（data: {...} 增量），逐段 yield 文本增量。
   * DeepSeek / 智谱 / 自定义 OpenAI 兼容端点均支持 stream: true。
   */
  async *streamComplete(options: CompleteOptions): AsyncGenerator<string> {
    for await (const delta of this.streamRaw(options)) {
      if (delta.content) yield delta.content;
    }
  }

  /** 详细流式补全：逐段透出 content / reasoning / toolCall 增量（供 /api/chat SSE 透传） */
  async *streamDetailed(options: CompleteOptions): AsyncGenerator<StreamDelta> {
    yield* this.streamRaw(options);
  }

  private async *streamRaw(options: CompleteOptions): AsyncGenerator<StreamDelta> {
    const res = await this.post(options, true);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(this.errorMessage(res.status, errText));
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error(`${this.displayName} 流式响应缺少 body`);

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: {
              delta?: {
                content?: string;
                reasoning_content?: string;
                reasoning?: string;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }[];
          };
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            yield { content: delta.content };
          }
          const reasoning = delta.reasoning_content ?? delta.reasoning;
          if (typeof reasoning === 'string' && reasoning.length > 0) {
            yield { reasoning };
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              yield {
                toolCall: {
                  index: tc.index,
                  id: tc.id,
                  name: tc.function?.name,
                  argumentsDelta: tc.function?.arguments,
                },
              };
            }
          }
        } catch {
          // 忽略无法解析的数据行
        }
      }
    }
  }
}
