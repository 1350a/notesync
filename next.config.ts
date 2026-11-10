import type { NextConfig } from "next";

/*
 * CSP 响应头（XSS 加固挂账项落地，doc/browser-local-inference.md §8）。
 * 关键取舍：
 * - script-src 'wasm-unsafe-eval'：ORT wasm 编译必需，缺省则本地推理全挂；
 * - 防闪烁内联脚本以 sha256 哈希放行（lib/settings/anti-flash.ts 的 ANTI_FLASH_SCRIPT，
 *   改动该脚本必须同步更新此哈希，否则暗色首帧闪烁回归且控制台可见 CSP 拒绝）；
 * - 生产保持严格 hash 白名单；开发追加 'unsafe-inline' 'unsafe-eval'
 *   （React 热更新与 dev overlay 需要，官方 CSP 指南的 dev 放宽口径）；
 * - worker-src blob:：ORT 的 wasm factory（.mjs）以模块 worker 装载；
 * - img-src blob: data:：聊天图片预览（dataUrl）与能力页 canvas 自检图；
 * - style-src 'unsafe-inline'：Next 内联关键 CSS 与 dev 样式注入所需（业界通行的低风险妥协）。
 */
const isDev = process.env.NODE_ENV === "development";
const ANTI_FLASH_SCRIPT_HASH = "'sha256-lTAWgpcDisIWwwuOMBiezzthsx2aKVtpYEESKifD7Kg='";
const csp = [
  "default-src 'self'",
  `script-src 'self' ${ANTI_FLASH_SCRIPT_HASH} 'wasm-unsafe-eval'${isDev ? " 'unsafe-inline' 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // OCR 依赖使用 Node 原生 require，避免 Turbopack 打包其 worker 文件
  serverExternalPackages: ["tesseract.js"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
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
