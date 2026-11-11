import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 第三方构建产物：pdfjs worker 由 node_modules 原样拷入 public，
    // 压缩后单行上百万字符，lint 它没有任何意义且会淹没真实问题
    "public/pdfjs/**",
    // 本地 OCR 运行时资产（npm run ocr:assets 派生），同上为第三方压缩产物
    "public/ocr/**",
    // 本地模型与 ORT 运行时资产（npm run local:assets 派生）：onnx 权重与
    // ort-wasm 的 .mjs glue 均为第三方产物，不应参与本项目的 lint
    "public/models/**",
    // 整文件注释停用的空壳文件（非活跃代码）：仅移出 lint 检查范围，
    // 文件本身原样保留在仓库中，便于按需 git checkout 恢复
    // （ChatInput / ChatMessage 已在 dev 侧直接删除，此处不再保留失效忽略项）
    "components/Sidebar.tsx",
    "components/ThemeSwitcher.tsx",
    "lib/agent/loop.ts",
    "lib/agent/tools.ts",
    "lib/agent/types.ts",
    "lib/harness/index.ts",
    "lib/harness/prompts.ts",
    "lib/harness/state.ts",
    "lib/harness/types.ts",
    "lib/rag/embedding.ts",
    "lib/rag/seed.ts",
    "lib/rag/store.ts",
    "lib/rag/types.ts",
    "lib/ocr.ts",
    "lib/pdf.ts",
    "lib/storage.ts",
    "lib/theme.ts",
    "lib/types.ts",
  ]),
]);

export default eslintConfig;
