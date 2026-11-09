/**
 * 工具调用核心循环（模式无关）
 *
 * 职责：
 * 1. 使用 adapter 构建请求。
 * 2. 调用 Provider 获取流，并通过 adapter.processStream 解析。
 * 3. 如果包含工具调用，执行工具并回填历史，开始下一轮。
 * 4. 如果包含 ask_user 工具，触发中断并退出。
 * 5. 解析失败（parseError）时重试 1 次，仍失败把原始输出视为普通回答
 *    （doc/tool-protocol.md §5.3）。
 * 6. 达到最大轮数仍未结束：追加 system 提示后做一次不带 tools 的收敛请求，
 *    finishReason 仍为 'max_rounds'（doc/tool-protocol.md §8.3）。
 */
import type { LLMProvider, ProviderMessage } from '@/lib/provider/types.ts';
import type { ToolAdapter } from './adapters/types.ts';
import { invokeTool } from './invoke.ts';
import type { ExtractedToolCalls, ToolDefinition, ToolInvocation, ToolLoopEvent } from './types.ts';

/** 极简异步队列：桥接回调式流处理和 Generator 产出 */
class AsyncQueue<T> {
  private queue: T[] = [];
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;

  push(item: T) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  complete() {
    this.done = true;
    for (const resolve of this.resolvers) {
      resolve({ value: undefined as unknown as T, done: true });
    }
    this.resolvers = [];
  }

  async *consume(): AsyncGenerator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        break;
      } else {
        // 等待新事件时保留 done 标记，结束信号只用于跳出循环，不得作为事件值下发
        const next = await new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
        if (next.done) break;
        yield next.value;
      }
    }
  }
}

export interface RunToolLoopOptions {
  model: string;
  provider: LLMProvider;
  messages: ProviderMessage[];
  adapter: ToolAdapter;
  tools: ToolDefinition[];
  maxRounds?: number;
  signal?: AbortSignal;
}

export async function* runToolLoop(options: RunToolLoopOptions): AsyncGenerator<ToolLoopEvent> {
  const { model, provider, adapter, tools, signal } = options;
  const maxRounds = options.maxRounds ?? 3;
  const currentMessages = [...options.messages];

  let usedRounds = 0;
  let finishReason = 'stop';
  // exhausted：while 因轮数耗尽退出（而非自然 stop）才触发收敛请求；
  // 单独用标志而不是比较 usedRounds，否则最后一轮自然 stop 也会被误标为 max_rounds
  let exhausted = false;
  let parseRetried = false; // 解析失败重试全程最多 1 次

  while (usedRounds < maxRounds) {
    usedRounds++;
    const req = adapter.buildRequest(model, currentMessages, tools);
    req.signal = signal;

    const queue = new AsyncQueue<ToolLoopEvent>();

    // 将返回值直接从 Promise 中抛出，避免外部变量在闭包中赋值导致 TS 类型收窄为 never
    const processPromise = (async (): Promise<ExtractedToolCalls> => {
      try {
        if (!provider.streamDetailed) {
          throw new Error('当前 Provider 不支持流式输出，无法使用工具调用');
        }
        const stream = provider.streamDetailed(req);
        return await adapter.processStream(
          stream,
          (c) => queue.push({ type: 'content', delta: c }),
          (r) => queue.push({ type: 'reasoning', delta: r })
        );
      } finally {
        queue.complete();
      }
    })();

    // 消费队列中的内容，保持流式输出
    for await (const event of queue.consume()) {
      yield event;
    }

    let callsData: ExtractedToolCalls;
    try {
      callsData = await processPromise;
    } catch (err) {
      yield {
        type: 'error',
        code: 'provider_error',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    if (callsData.parseError) {
      // §8.3 兜底：重试 1 次（不消耗轮数）；仍失败把原始输出视为普通回答。
      // raw 为空（如 native 参数 JSON 损坏且无正文）则如实报 parse_error，避免静默空回复。
      if (!parseRetried) {
        parseRetried = true;
        usedRounds--;
        continue;
      }
      if (callsData.raw.trim()) {
        yield { type: 'content', delta: callsData.raw };
        finishReason = 'stop';
        exhausted = false;
        break;
      }
      yield { type: 'error', code: 'parse_error', message: callsData.parseError };
      return;
    }

    if (callsData.calls.length === 0) {
      finishReason = 'stop';
      exhausted = false;
      break;
    }

    // 执行工具调用
    const results: ToolInvocation[] = [];
    const pendingCalls = callsData.calls;

    for (const call of pendingCalls) {
      yield { type: 'tool_call', id: call.id, name: call.name, arguments: call.arguments };

      const startMs = Date.now();
      const result = await invokeTool({
        name: call.name,
        args: call.arguments,
        ctx: { signal, timeoutMs: 15000 },
      });
      const ms = Date.now() - startMs;

      results.push(result);

      if (result.kind === 'awaiting_user') {
        yield { type: 'awaiting_user', questions: result.questions, toolCallId: call.id };
        yield { type: 'done', usedRounds, finishReason: 'awaiting_user' };
        return;
      }

      yield {
        type: 'tool_result',
        id: call.id,
        ok: result.ok,
        summary: result.summary,
        ms,
      };
    }

    // 将结果回填到历史
    adapter.appendResults(currentMessages, pendingCalls, results);
    exhausted = true; // 本轮执行了工具，若循环条件不再满足则是轮数耗尽
  }

  if (exhausted) {
    finishReason = 'max_rounds';

    // 收敛请求：追加 system 提示 + 不带 tools 的普通请求（doc/tool-protocol.md §8.3）
    const convergeMessages: ProviderMessage[] = [
      ...currentMessages,
      {
        role: 'system',
        content: '工具调用轮数已达上限，请不要再调用任何工具，直接回答用户最新的问题。',
      },
    ];
    const req = adapter.buildRequest(model, convergeMessages, []);
    req.signal = signal;

    try {
      if (!provider.streamDetailed) {
        throw new Error('当前 Provider 不支持流式输出，无法使用工具调用');
      }
      const stream = provider.streamDetailed(req);
      // 收敛请求是纯文本补全：直接消费增量，不走适配器（无工具语义，忽略 toolCall 分片）
      for await (const delta of stream) {
        if (delta.reasoning) yield { type: 'reasoning', delta: delta.reasoning };
        if (delta.content) yield { type: 'content', delta: delta.content };
      }
    } catch (err) {
      yield {
        type: 'error',
        code: 'provider_error',
        message: err instanceof Error ? err.message : String(err),
      };
      // 收敛请求失败与 §8.2 模型请求失败语义一致：只发 error，不开 done
      return;
    }
  }

  yield { type: 'done', usedRounds, finishReason };
}
