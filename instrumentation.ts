/**
 * Next.js 启动钩子（`register` 自 Next 15 起 stable，无需 experimental 开关）。
 *
 * 只做一件事：进程启动时把环境变量里"填了但不会按预期生效"的项各 warn 一条
 * （doc/help-about-.env.md §9.1）。判定口径一律不动、不抛错——配置写错不该阻塞启动。
 */
export async function register() {
  // register 在 Node.js 与 Edge 两种运行时都会调用；本项目的环境变量只在 Node.js 侧读取
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { validateEnv } = await import('./lib/config/env.ts');
  validateEnv();
}
