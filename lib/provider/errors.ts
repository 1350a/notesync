/**
 * Provider 层错误类型（safety-protocol.md §3.2）
 *
 * DeepSeek 开启 safety_check 后，输入（用户消息 / tool_result 内容等）未过审时
 * 上游返回 400 Content Exists Risk。该场景重试只会被再拦一次（§2：content_blocked
 * 不可重试），必须与普通 provider_error 区分——用专门的 Error 子类承载语义，
 * 由工具循环 / 路由层按 instanceof 归一为 content_blocked 拦截链路。
 *
 * 注意：loop.ts 以 node --experimental-strip-types 直跑（smoke:loop），值导入必须
 * 走相对路径，不能用 @ 别名（同 lib/config/env.ts 的处理）。
 */

/** 上游内容安全审核拒绝（输入未过审 400 Content Exists Risk 等） */
export class UpstreamContentBlockedError extends Error {
  /** 触发拦截的 HTTP 状态码（400；预留扩展） */
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UpstreamContentBlockedError';
    this.status = status;
  }
}
