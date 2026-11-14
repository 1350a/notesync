#!/usr/bin/env node
/*
 * 复制 pdfjs 运行时资产到 public/pdfjs/。
 *
 * 为什么是"复制"而不是提交产物：public/pdfjs 属派生产物（见 doc/file-intake.md §7），
 * 来源全部在 npm 依赖内，本脚本可离线幂等重复执行，避免 ~2.3MB 的 cmap/字体二进制入库。
 * 且源与 node_modules 里安装的 pdfjs-dist 恒同版本——升级依赖后重装即同步，
 * 不会出现提交态 worker/cmaps 与 API 新版本错配导致 getDocument 抛错。
 * postinstall 自动执行（PDF 是主链路，资产缺失不应依赖手动记得补）；也可单独 npm run pdfjs:assets。
 */
import { access, cp, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const COPIES = [
  {
    type: "file",
    from: "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    to: "public/pdfjs/pdf.worker.min.mjs",
  },
  {
    type: "dir",
    from: "node_modules/pdfjs-dist/cmaps",
    to: "public/pdfjs/cmaps",
  },
  {
    type: "dir",
    from: "node_modules/pdfjs-dist/standard_fonts",
    to: "public/pdfjs/standard_fonts",
  },
];

let failed = false;
for (const { type, from, to } of COPIES) {
  const src = path.join(root, from);
  const dest = path.join(root, to);
  try {
    await access(src);
    await mkdir(path.dirname(dest), { recursive: true });
    if (type === "dir") {
      await cp(src, dest, { recursive: true });
    } else {
      await copyFile(src, dest);
    }
    console.log(`ok  ${from} -> ${to}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${from} -> ${to}:`, err.message);
  }
}

if (failed) {
  console.error("\n资产复制未完成：请确认已执行 npm install（node_modules/pdfjs-dist 存在）。");
  process.exitCode = 1;
} else {
  console.log("\n完成：worker + cmaps + standard_fonts 已就位于 public/pdfjs/。");
}
