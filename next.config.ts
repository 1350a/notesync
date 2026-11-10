import type { NextConfig } from "next";

/**
 * 基础版 CSP（doc/browser-local-inference.md §6 本分支落地项）。
 * 默认全站同源，只按现有实现的实际需要放行：
 * - script 'unsafe-inline'：Next 运行时注入的内联 bootstrap 与防闪烁内联脚本；
 * - script 'wasm-unsafe-eval'：ONNX Runtime / Tesseract 的 WebAssembly 编译所需，
 *   只放开 wasm 编译而不放宽 JS eval；
 * - worker-src 'self' blob:：Turbopack 模块 Worker（同源 chunk）与 ORT 多线程
 *   wasm 的 Worker（可能经 blob 创建）；
 * - img / font / media 的 data:/blob:：Markdown 内联图与上传预览、KaTeX 字体。
 * 开发环境额外放开 'unsafe-eval' 与 ws:，否则 HMR/React Refresh 无法工作。
 */
const isDev = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' blob: data:${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },
  /* config options here */
  // OCR 依赖使用 Node 原生 require，避免 Turbopack 打包其 worker 文件
  serverExternalPackages: ["tesseract.js"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
