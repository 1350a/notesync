import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** 仓库根目录：ESM 下没有 __dirname，用 import.meta.url 反解 */
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // 与 tsconfig 的 paths（@/* -> ./*）保持一致：用例统一用 @/ 前缀引用被测模块，
    // 避免相对路径层级漂移
    alias: { '@': root },
  },
  test: {
    // 被测对象全部是纯函数（无 DOM / 无浏览器 API）：node 环境足够，
    // 不引入 jsdom 等非必要依赖
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
