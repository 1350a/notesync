/**
 * 工具注册表（进程内单例）
 *
 * 设计：
 * - 工具在模块加载时注册（P2 由 builtin/index.ts 统一调用）；
 * - 重复注册直接抛错，避免静默覆盖导致行为漂移；
 * - getEnabledTools 按 enabled 字段过滤（P1 恒 true，工具级开关预留）。
 */
import type { ToolDefinition } from './types.ts';

const registry = new Map<string, ToolDefinition>();

/** 注册单个工具 */
export function registerTool(def: ToolDefinition): void {
  if (!def.name || !def.name.trim()) {
    throw new Error('工具注册失败：name 不能为空');
  }
  if (registry.has(def.name)) {
    throw new Error(`工具注册失败：${def.name} 已存在`);
  }
  registry.set(def.name, def);
}

/** 按名称查询 */
export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

/** 是否已注册 */
export function hasTool(name: string): boolean {
  return registry.has(name);
}

/** 列出全部工具（含已禁用） */
export function listTools(): ToolDefinition[] {
  return Array.from(registry.values());
}

/** 列出已启用的工具（供 render / loop 使用） */
export function getEnabledTools(): ToolDefinition[] {
  return listTools().filter((t) => t.enabled !== false);
}

/**
 * 仅供测试/热重载使用：清空注册表。
 * 生产代码不应调用。
 */
export function __clearRegistry(): void {
  registry.clear();
}
