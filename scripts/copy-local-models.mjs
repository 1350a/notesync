#!/usr/bin/env node
/*
 * 准备浏览器端本地推理资产到 public/models/。
 *
 * 见 doc/browser-local-inference.md §3：
 * - 模型权重从 HF 下载（默认直连，HF_MIRROR 可切镜像），镜像完整仓库目录结构；
 * - ORT wasm 从 transformers 嵌套依赖内复制（bundler 实际解析的副本，
 *   根目录 onnxruntime-web 版本不同不可用）；
 * - public/models/ 为派生产物不入库；运行时零外联，资产缺失 = 功能不可用。
 */
import { access, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const MODEL_REPO = "onnx-community/bge-small-zh-v1.5-ONNX";
const BASE = process.env.HF_MIRROR || "https://huggingface.co";
const DEST = "public/models/bge-small-zh-v1.5";
const ORT_SRC = "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist";
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
];

async function existsAtLeast(rel, minBytes) {
  try {
    const info = await stat(path.join(root, rel));
    return info.isFile() && info.size >= minBytes;
  } catch {
    return false;
  }
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
    console.error(`FAIL ${item.file}: ${err.message}`);
  }
}

// 2) 复制 ORT wasm（来源在依赖内，可离线重复执行）
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
  console.error(
    `\n资产准备未完成：模型下载需可访问 ${BASE}（或设 HF_MIRROR 切镜像）。` +
      `\n运行时缺资产时功能不可用，页面会提示本命令。`,
  );
  process.exitCode = 1;
} else {
  console.log(`\n完成：模型位于 ${DEST}/，ORT wasm 位于 ${ORT_DEST}/。`);
}
