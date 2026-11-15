/**
 * 内置工具统一注册入口
 *
 * 不在模块加载时自动注册（避免循环依赖和不可控的副作用），
 * 由调用方显式调用 registerBuiltinTools()。
 * 幂等：已注册则跳过（方便测试或热重载反复调用）。
 */
import { hasTool, registerTool } from '../registry.ts';
import { askUserTool } from './ask_user.ts';

/** 注册所有内置工具 */
export function registerBuiltinTools(): void {
  if (!hasTool(askUserTool.name)) {
    registerTool(askUserTool);
  }
}
