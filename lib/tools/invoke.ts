/**
 * 工具执行入口（单工具）
 *
 * 职责：
 * 1. 查注册表 → 找不到返回"未知工具"错误
 * 2. 参数校验 → 失败返回错误包装
 * 3. handler 存在性检查 → 无 handler 返回"未实现"
 * 4. 带超时与中止执行 → 抛错/超时/中止统一转为 ok=false 包装
 * 5. 成功结果 → 自动生成 summary（handler 可覆盖）
 *
 * 永不抛：调用方（loop）不需要 try/catch。
 * 语义详见 doc/tool-protocol.md §3.1 与 §8。
 */
import { getTool } from './registry.ts';
import type {
  ToolContext,
  ToolDefinition,
  ToolHandler,
  ToolHandlerReturn,
  ToolInvocation,
} from './types.ts';
import { validateArguments } from './validate.ts';

/** 单工具默认执行超时（ms） */
const DEFAULT_TIMEOUT_MS = 15_000;
/** 自动生成的 summary 最大字符数（仅供 SSE 展示，不影响回填模型的 data） */
const SUMMARY_MAX_CHARS = 200;

export interface InvokeOptions {
  /** 工具名 */
  name: string;
  /** 参数对象（未经校验） */
  args: Record<string, unknown>;
  /** 执行上下文（可选） */
  ctx?: ToolContext;
  /**
   * 本轮可用工具集（可选）。
   *
   * 解析优先级：先在本数组中按 `name` 精确匹配，未命中再回落 `getTool(name)` 查全局注册表。
   * 用于承接**逐请求工厂件**（如 `submit_diagnosis`：由 route 每次请求经
   * `createSubmitDiagnosisTool(store)` 创建并直接拼入 tools 数组，不走注册表），
   * 否则这类工具会因注册表中不存在而被误判为"未知工具"。
   */
  defs?: ToolDefinition[];
}

/** 执行单个工具，永不抛 */
export async function invokeTool(opts: InvokeOptions): Promise<ToolInvocation> {
  // 工具解析优先级：本轮 defs（逐请求工厂件）精确匹配 → 回落全局注册表
  const def = opts.defs?.find((d) => d.name === opts.name) ?? getTool(opts.name);
  if (!def) {
    const msg = `未知工具：${opts.name}`;
    return { kind: 'result', ok: false, error: msg, summary: msg };
  }

  const validation = validateArguments(def.inputSchema, opts.args);
  if (!validation.valid) {
    const msg = `参数校验失败：${validation.errors.join('；')}`;
    return { kind: 'result', ok: false, error: msg, summary: msg };
  }

  if (!def.handler) {
    const msg = `工具 ${opts.name} 未实现`;
    return { kind: 'result', ok: false, error: msg, summary: msg };
  }
  // 显式取到局部变量：避免后续函数调用让 TS 丢失 def.handler 的窄化
  const handler: ToolHandler = def.handler;

  const ctx: ToolContext = {
    signal: opts.ctx?.signal,
    timeoutMs: opts.ctx?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  try {
    const result = await runWithTimeout(handler, validation.value, ctx);
    if (result.kind === 'awaiting_user') {
      // ask_user 中断：原样透传，loop 据此发 awaiting_user 事件并结束本轮
      return result;
    }
    return {
      kind: 'result',
      ok: true,
      data: result.data,
      summary: result.summary ?? summarize(result.data),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '工具执行失败';
    return { kind: 'result', ok: false, error: msg, summary: msg };
  }
}

/** 带超时与中止的执行包装（Promise.race + 清理） */
async function runWithTimeout(
  handler: ToolHandler,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolHandlerReturn> {
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = ctx.signal;

  // 已中止：立即返回
  if (signal?.aborted) {
    throw new Error('工具执行已中止');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`工具执行超时（${timeoutMs}ms）`)), timeoutMs);
  });

  // 中止信号：与超时并列参与 race；无 signal 时不构造
  const abortPromise: Promise<never> | null = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('工具执行已中止'));
        signal.addEventListener('abort', onAbort, { once: true });
      })
    : null;

  try {
    const races: Promise<ToolHandlerReturn>[] = [handler(args, ctx), timeoutPromise];
    if (abortPromise) races.push(abortPromise);
    return await Promise.race(races);
  } finally {
    // 无论成功/失败/中止都清理，避免 timer 和监听器泄漏
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** 自动生成 summary（JSON 序列化并截断） */
function summarize(data: unknown): string {
  if (data === null || data === undefined) return '（空）';
  if (typeof data === 'string') return truncate(data, SUMMARY_MAX_CHARS);
  try {
    return truncate(JSON.stringify(data), SUMMARY_MAX_CHARS);
  } catch {
    return '（无法序列化）';
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
