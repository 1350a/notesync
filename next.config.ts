import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
