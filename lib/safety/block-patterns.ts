/**
 * 拦截判定的基础特征集（与判定引擎分离，便于配置化扩展）
 *
 * BLOCKED_FINISH_REASONS：上游 finish_reason 的异常终止值集合。
 * OpenAI 兼容规范里 content_filter 是标准值；各家私有值实测后在此追加（D 级）。
 */
export const BLOCKED_FINISH_REASONS: ReadonlySet<string> = new Set([
  'content_filter',
  'sensitive',
  'risk_control', // 智谱流式外私有值的占位（实测后修正）
]);
