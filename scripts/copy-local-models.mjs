#!/usr/bin/env node
/*
 * 准备浏览器端本地推理资产到 public/models/。
 *
 * 见 doc/browser-local-inference.md §3：
 * - 模型权重从 HF 下载（默认直连，HF_MIRROR 可切镜像），镜像完整仓库目录结构；
 * - ORT wasm 从根依赖 onnxruntime-web/dist 复制：package.json 的 overrides 已把
 *   全树 ORT 统一到 transformers 精确依赖的同一版本，bundler 与拷贝脚本解析到
 *   同一份副本，wasm 与 glue 必然同包同版本；
 * - public/models/ 为派生产物不入库；运行时零外联，资产缺失 = 功能不可用。
 */
import { access, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const MODEL_REPO = "onnx-community/bge-small-zh-v1.5-ONNX";
const DEFAULT_BASE = "https://huggingface.co";
// 手动兜底镜像：大文件可能 302 回被墙 CDN，仅作直连不通时的备选下载源
const MIRROR_BASE = "https://hf-mirror.com";
const BASE = process.env.HF_MIRROR || DEFAULT_BASE;
const DEST = "public/models/bge-small-zh-v1.5";
const ORT_SRC = "node_modules/onnxruntime-web/dist";
const ORT_DEST = "public/models/ort";

/** 下载清单：minBytes 按实测体积（2026-11-10）设下限，拦截截断/HTML 错误页 */
const DOWNLOADS = [
  { file: "config.json", minBytes: 500 },
  { file: "tokenizer.json", minBytes: 100_000 },
  { file: "tokenizer_config.json", minBytes: 200 },
  { file: "onnx/model_quantized.onnx", minBytes: 100_000 },
  { file: "onnx/model_quantized.onnx_data", minBytes: 20_000_000 },
  { file: "onnx/model_q4f16.onnx", minBytes: 30_000 },
  { file: "onnx/model_q4f16.onnx_data", minBytes: 25_000_000 },
];

/** ORT wasm：CPU（wasm 档）+ WebGPU（jsep 档）各一对，与引擎双后端对应 */
const ORT_FILES = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  // 非跨源隔离环境（无 SharedArrayBuffer）ORT 实际加载 asyncify 档，必须与上面两档一起就位
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
];

async function existsAtLeast(rel, minBytes) {
  try {
    const info = await stat(path.join(root, rel));
    return info.isFile() && info.size >= minBytes;
  } catch {
    return false;
  }
}

/** 体积下限的人类可读展示（十进制口径，与网络传输一致） */
function formatBytes(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

async function download({ file, minBytes }) {
  const dest = path.join(root, DEST, file);
  const url = `${BASE}/${MODEL_REPO}/resolve/main/${file}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}（源 ${BASE}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) {
    throw new Error(`体积异常：${buf.length} < 下限 ${minBytes}（疑似错误页/截断）`);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`ok   ${file}（${(buf.length / 1024 / 1024).toFixed(1)} MB）`);
}

let failed = false;
// 仅收集模型下载失败项：ORT 与语言包来源在依赖/仓库内，缺失应 npm install
// 或 ocr:assets 解决，不进手动下载清单
const failedDownloads = [];

// 1) 下载模型权重与分词器（已存在且达标则跳过，避免每次重复下载几十 MB）
for (const item of DOWNLOADS) {
  const dest = path.join(DEST, item.file);
  try {
    if (await existsAtLeast(dest, item.minBytes)) {
      console.log(`skip ${item.file}（已就位）`);
      continue;
    }
    await download(item);
  } catch (err) {
    failed = true;
    failedDownloads.push(item);
    console.error(`FAIL ${item.file}: ${err.message}`);
  }
}

// 2) 复制 ORT wasm（来源为依赖内单一副本，可离线重复执行）
// 前置校验：已安装 ORT 版本必须与 package.json 声明一致，否则拷出的 wasm 可能与
// 打包进 bundle 的 glue 不同版本（overrides 失效、漏装都会走到这里）
try {
  const installedOrt = JSON.parse(
    await readFile(path.join(root, "node_modules/onnxruntime-web/package.json"), "utf8"),
  ).version;
  const declaredOrt = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ).dependencies?.["onnxruntime-web"];
  if (installedOrt !== declaredOrt) {
    failed = true;
    console.error(
      `FAIL ORT 版本漂移：已安装 ${installedOrt} ≠ package.json 声明 ${declaredOrt}（先 npm install）`,
    );
  } else {
    console.log(`ok   ORT 版本 ${installedOrt}（wasm 与 glue 同包同版本）`);
  }
} catch (err) {
  failed = true;
  console.error(`FAIL ORT 版本校验: ${err.message}`);
}

for (const name of ORT_FILES) {
  const from = path.join(root, ORT_SRC, name);
  const to = path.join(root, ORT_DEST, name);
  try {
    await access(from);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
    console.log(`ok   ORT ${name}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ORT ${name}: ${err.message}`);
  }
}

if (failed) {
  if (failedDownloads.length > 0) {
    // 被墙设备上自动下载可能无解（直连失败、镜像大文件 302 回被墙 CDN），
    // 逐文件给出可浏览器直接取件的 URL 与放置路径，手动补齐后重跑本命令校验
    console.error(
      "\n手动下载兜底清单（任一源下载后放入放置路径，重跑本命令校验补齐）：",
    );
    for (const item of failedDownloads) {
      console.error(`\n  ${item.file}`);
      console.error(
        `    直连源  ${DEFAULT_BASE}/${MODEL_REPO}/resolve/main/${item.file}`,
      );
      console.error(
        `    镜像源  ${MIRROR_BASE}/${MODEL_REPO}/resolve/main/${item.file}`,
      );
      console.error(
        `    放置    ${DEST}/${item.file}（体积 ≥ ${formatBytes(item.minBytes)}）`,
      );
    }
  }
  console.error(
    `\n资产准备未完成：模型下载需可访问 ${BASE}（或设 HF_MIRROR 切镜像）。` +
      `\n运行时缺资产时功能不可用，页面会提示本命令。`,
  );
  process.exitCode = 1;
} else {
  console.log(`\n完成：模型位于 ${DEST}/，ORT wasm 位于 ${ORT_DEST}/。`);
}
