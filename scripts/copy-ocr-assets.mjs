#!/usr/bin/env node
/*
 * 复制本地 OCR 运行时资产到 public/ocr/。
 *
 * 为什么是"复制"而不是提交产物：public/ocr 属派生产物（见 doc/browser-local-ocr.md §3），
 * 来源全部在仓库或 npm 依赖内，本脚本可离线重复执行，避免几十 MB 的 wasm 二进制入库。
 * worker 会按设备 SIMD 能力在 6 个 core 变体中自选其一，因此全量复制，
 * 缺文件只在运行时才会暴露，不值得为省 ~15MB 磁盘引入探测分支。
 */
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const COPIES = [
  {
    from: "node_modules/tesseract.js/dist/worker.min.js",
    to: "public/ocr/worker/worker.min.js",
  },
  ...[
    "tesseract-core.wasm.js",
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-simd.wasm.js",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-relaxedsimd.wasm.js",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
  ].map((name) => ({
    from: `node_modules/tesseract.js-core/${name}`,
    to: `public/ocr/core/${name}`,
  })),
  {
    from: "tessdata/chi_sim.traineddata.gz",
    to: "public/ocr/tessdata/chi_sim.traineddata.gz",
  },
  {
    from: "tessdata/eng.traineddata.gz",
    to: "public/ocr/tessdata/eng.traineddata.gz",
  },
];

let failed = false;
for (const { from, to } of COPIES) {
  const src = path.join(root, from);
  const dest = path.join(root, to);
  try {
    await access(src);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    console.log(`ok  ${from} -> ${to}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${from} -> ${to}:`, err.message);
  }
}

if (failed) {
  console.error("\n资产复制未完成：请确认已执行 npm install 且仓库根 tessdata/ 存在。");
  process.exitCode = 1;
} else {
  console.log(`\n完成：${COPIES.length} 个文件已就位于 public/ocr/。`);
}
