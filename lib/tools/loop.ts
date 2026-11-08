/**
 * 工具调用核心循环（模式无关）
 *
 * 职责：
 * 1. 使用 adapter 构建请求。
 * 2. 调用 Provider 获取流，并通过 adapter.processStream 解析。
 * 3. 如果包含工具调用，执行工具并回填历史，开始下一轮。
 * 4. 如果包含 ask_user 工具，触发中断并退出。
 * 5. 达到最大轮数仍未结束，追加提示强制收敛。
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
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      return;
    }

    if (callsData.parseError) {
      yield { type: 'error', message: callsData.parseError };
      return;
    }

    if (callsData.calls.length === 0) {
      finishReason = 'stop';
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
        yield { type: 'awaiting_user', question: result.question, toolCallId: call.id };
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
  }

  if (usedRounds >= maxRounds) {
    finishReason = 'max_rounds';
  }

  yield { type: 'done', usedRounds, finishReason };
}
