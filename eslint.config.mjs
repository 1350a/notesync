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
  ]),
]);

export default eslintConfig;
