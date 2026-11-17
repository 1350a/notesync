#!/usr/bin/env node
/**
 * 发布脚本：构建 → 组装 → 真 zip → SHA256 → 冒烟 → 建 GitHub Release。
 *
 * 版本号唯一来源是 package.json（tag = v<version>，zip 名与 README 全部派生），
 * 本脚本不硬编码任何版本号。
 *
 * 背景（勿删）：v1.0.0 tag 曾被发布过一次，GitHub immutable releases 机制将其
 * 永久烧录——删 release、删远端 tag、关闭开关、API 建 tag 均无法解除，重建
 * Release 一律 422。发版前必须确认 v<version> 这个名字从未发布过；否则换名。
 *
 * 用法：
 *   node scripts/release.mjs --notes <md 路径> [--draft] [--skip-smoke]
 *        [--skip-ci-check] [--title <t>] [--out <dir>]        # 完整发布
 *   node scripts/release.mjs --package-only [--out <dir>]    # 只构建+打包
 *                                                             # （修复已发布 release 用）
 * zip 格式说明：优先用 System32 的 bsdtar 显式 --format=zip（Git Bash 里裸 `tar`
 * 是 GNU tar，`tar -a -f x.zip` 会产出名叫 .zip 的 tar——v1.0.2 发布件即此坑，
 * Linux 上 unzip 不认）；无 bsdtar 时回退 jszip。两种路径产物都过 PK 头 +
 * jszip 中央目录解析双重校验，保证 unzip 兼容。
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

// ---- 参数与常量 ----
const argv = process.argv.slice(2);
const args = {
  notes: takeArg("--notes"),
  out: takeArg("--out") ?? path.join(os.tmpdir(), "notesync-release", "out"),
  title: takeArg("--title"),
  packageOnly: argv.includes("--package-only"),
  skipSmoke: argv.includes("--skip-smoke"),
  skipCiCheck: argv.includes("--skip-ci-check"),
  draft: argv.includes("--draft"),
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesDir = path.join(repoRoot, "scripts", "release-templates");
const BSDTAR = "C:\\Windows\\System32\\tar.exe";

function takeArg(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
function fail(msg) {
  console.error("FAIL: " + msg);
  process.exit(1);
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: repoRoot, ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} 失败（exit ${r.status}）\n${r.stderr ?? ""}`);
  return (r.stdout ?? "").trim();
}
function mb(n) {
  return (n / 1048576).toFixed(1) + " MB";
}

// 版本号唯一来源
const version = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+/.test(version)) fail(`package.json 版本号异常: ${version}`);
const tag = `v${version}`;
const FULL_NAME = `notesync-${tag}-standalone-full`;
const SLIM_NAME = `notesync-${tag}-standalone-slim`;

console.log(`发布版本: ${tag}（来源 package.json）`);

// ---- 前置检查（--package-only 跳过：修复已发布 release 时不要求干净 main）----
if (!args.packageOnly) {
  const branch = sh("git", ["branch", "--show-current"]);
  if (branch !== "main") fail(`必须在 main 上发布（当前 ${branch}）`);
  if (sh("git", ["status", "--porcelain"]) !== "")
    fail("工作树不干净，先提交或 stash");
  sh("git", ["fetch", "origin", "main", "--quiet"]);
  if (sh("git", ["rev-parse", "main"]) !== sh("git", ["rev-parse", "origin/main"]))
    fail("本地 main 与 origin/main 不一致，先 pull/push 对齐");
  if (sh("git", ["ls-remote", "origin", `refs/tags/${tag}`]) !== "")
    fail(`远端已存在 tag ${tag}，换一个版本号`);
  console.log(
    `提醒：确认 ${tag} 这个名字从未在 GitHub 发布过——immutable releases 对` +
      "发布过的 tag 永久锁定（删 release/删 tag/关设置均不解锁）。"
  );
  if (!args.skipCiCheck) {
    const head = sh("git", ["rev-parse", "HEAD"]);
    const runs = sh("gh", [
      "run", "list", "--branch", "main", "--limit", "10",
      "--json", "headSha,conclusion,status",
    ]);
    const ok = JSON.parse(runs).some(
      (r) => r.headSha === head && r.status === "completed" && r.conclusion === "success"
    );
    if (!ok) fail("main 尖端 CI 未绿，先等 CI 或加 --skip-ci-check");
  }
}

// ---- 构建 ----
console.log("== npm run build ==");
spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true, cwd: repoRoot });
const buildStandalone = path.join(repoRoot, ".next", "standalone");
const buildStatic = path.join(repoRoot, ".next", "static");
const repoPublic = path.join(repoRoot, "public");
for (const p of [buildStandalone, buildStatic, repoPublic])
  if (!existsSync(p)) fail(`缺 ${p}，构建失败`);
if (!existsSync(path.join(repoPublic, "models")))
  fail("public/models 缺失，先跑 npm run local:assets 补齐派生资产");
if (!existsSync(path.join(repoPublic, "ocr")))
  fail("public/ocr 缺失，先跑 npm run ocr:assets");

// ---- 组装 ----
function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else total += statSync(full).size;
    }
  }
  return total;
}
function assertNoLinks(root) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      // Windows junction 在 Node 里也表现为 symbolicLink，绝对路径会让 zip 不可迁移
      if (e.isSymbolicLink()) fail(`残留 symlink/junction: ${full}`);
      if (e.isDirectory()) stack.push(full);
    }
  }
}
function assertNoNative(root) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/win32|darwin|linux-gnu|\.node$/i.test(e.name))
        fail(`原生二进制残留: ${full}（跨平台要求被破坏）`);
    }
  }
}
function copyReadme(variant, stage) {
  const tpl = readFileSync(path.join(templatesDir, `README-${variant}.txt`), "utf8");
  // \ufeff BOM 保证旧版记事本不乱码
  writeFileSync(path.join(stage, "README.txt"), "\ufeff" + tpl.replaceAll("{{VERSION}}", version), "utf8");
}
function copyStartScripts(stage) {
  for (const f of ["start.sh", "start.bat"]) {
    let c = readFileSync(path.join(templatesDir, f), "utf8").replaceAll("{{VERSION}}", version);
    if (f === "start.bat" && !c.includes("\r\n")) c = c.replace(/\n/g, "\r\n"); // cmd 对 LF 的 label 解析有坑
    writeFileSync(path.join(stage, f), c, "utf8");
  }
}

mkdirSync(args.out, { recursive: true });
for (const variant of ["full", "slim"]) {
  const name = variant === "full" ? FULL_NAME : SLIM_NAME;
  const stage = path.join(args.out, name);
  rmSync(stage, { recursive: true, force: true });

  // standalone 本体 + 前端静态产物 + public（server.js 默认不拷，官方要求手动补齐）
  cpSync(buildStandalone, stage, { recursive: true, dereference: true });
  cpSync(buildStatic, path.join(stage, ".next", "static"), { recursive: true, dereference: true });
  cpSync(repoPublic, path.join(stage, "public"), { recursive: true, dereference: true });
  if (variant === "slim") rmSync(path.join(stage, "public", "models"), { recursive: true, force: true });

  assertNoLinks(stage);

  // 密钥防线：Next 会把构建机 .env* 全拷进 standalone，先剔再补回纯占位的模板
  for (const f of readdirSync(stage)) {
    if (f === ".env" || f.startsWith(".env.")) {
      rmSync(path.join(stage, f));
      console.log(`[${name}] 已剔除 ${f}`);
    }
  }
  copyFileSync(path.join(repoRoot, ".env.example"), path.join(stage, ".env.example"));
  copyReadme(variant, stage);
  copyStartScripts(stage);

  // sharp/@img 是 nft 追进全局 trace 的原生 win32 包，config 层甩不掉只能物理删
  for (const rel of ["node_modules/sharp", "node_modules/@img"]) {
    rmSync(path.join(stage, rel), { recursive: true, force: true });
  }
  assertNoNative(stage);
  console.log(`[${name}] 组装完成: ${mb(dirSize(stage))}`);
}

// ---- 真 zip（bsdtar 显式格式优先，jszip 兜底）----
async function zipWithJszip(dir, outFile) {
  const zip = new JSZip();
  const base = path.dirname(dir);
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      const rel = path.relative(base, full).replaceAll("\\", "/");
      if (e.isDirectory()) stack.push(full);
      else zip.file(rel, readFileSync(full));
    }
  }
  writeFileSync(outFile, await zip.generateAsync({
    type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 },
  }));
}
function bsdtarAvailable() {
  if (process.platform !== "win32" || !existsSync(BSDTAR)) return false;
  return (spawnSync(BSDTAR, ["--version"], { encoding: "utf8" }).stdout ?? "").includes("bsdtar");
}
async function verifyZip(zipFile, rootName) {
  const buf = readFileSync(zipFile);
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04))
    fail(`${path.basename(zipFile)} 不是 zip（PK 头缺失）——多半踩了 GNU tar 的假 zip 坑`);
  const zip = await JSZip.loadAsync(buf); // 中央目录解析失败 = unzip 也不认
  if (!zip.file(`${rootName}/server.js`)) fail(`${path.basename(zipFile)} 缺 ${rootName}/server.js`);
  return Object.keys(zip.files).length;
}

const zips = [];
for (const variant of ["full", "slim"]) {
  const name = variant === "full" ? FULL_NAME : SLIM_NAME;
  const stage = path.join(args.out, name);
  const zipFile = path.join(args.out, `${name}.zip`);
  rmSync(zipFile, { force: true });
  if (bsdtarAvailable()) {
    spawnSync(BSDTAR, ["-c", "--format=zip", "-f", zipFile, name], {
      cwd: args.out, stdio: "inherit",
    });
  } else {
    console.log(`[${name}] 无 bsdtar，走 jszip`);
    await zipWithJszip(stage, zipFile);
  }
  const entries = await verifyZip(zipFile, name);
  console.log(`[${name}] zip 校验通过（${entries} 条目，${mb(statSync(zipFile).size)}）`);
  zips.push(zipFile);
}

// ---- SHA256（node crypto，不依赖 sha256sum）----
const sums = zips
  .map((f) => `${createHash("sha256").update(readFileSync(f)).digest("hex")}  ${path.basename(f)}`)
  .join("\n") + "\n";
const sumsFile = path.join(args.out, "SHA256SUMS.txt");
writeFileSync(sumsFile, sums);

// ---- 冒烟（full 包起服务探活；slim 仅少 models，不单独冒烟）----
if (!args.skipSmoke) {
  console.log("== 冒烟（full 包） ==");
  const port = 30000 + Math.floor(Math.random() * 9999);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(args.out, FULL_NAME),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  const deadline = Date.now() + 25_000;
  let root = 0, chat = 0;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok) { root = r.status; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (root === 200) {
    try { chat = (await fetch(`http://127.0.0.1:${port}/chat`)).status; } catch {}
  }
  child.kill();
  await new Promise((r) => {
    const t = setTimeout(r, 3000);
    child.on("exit", () => { clearTimeout(t); r(); });
  });
  if (root !== 200) fail(`冒烟失败: GET / -> ${root}`);
  if (chat !== 200) fail(`冒烟失败: GET /chat -> ${chat}`);
  console.log(`冒烟通过: / -> ${root}, /chat -> ${chat}`);
}

// ---- 发布 ----
if (args.packageOnly) {
  console.log(`\nOK（--package-only）：产物与 SHA256SUMS 在 ${args.out}`);
  console.log(`上传修复用: gh release upload ${tag} --clobber <zip 文件...> ${sumsFile}`);
} else {
  if (!args.notes) fail("发布需要 --notes <markdown 路径>");
  if (!existsSync(args.notes)) fail(`notes 文件不存在: ${args.notes}`);
  run("git", ["tag", "-a", tag, "-m", `NoteSync ${tag}`]);
  run("git", ["push", "origin", tag]);
  const ghArgs = [
    "release", "create", tag,
    "--title", args.title ?? `NoteSync ${tag}`,
    "--notes-file", path.resolve(args.notes),
  ];
  if (args.draft) ghArgs.push("--draft");
  ghArgs.push(...zips, sumsFile);
  run("gh", ghArgs);
  console.log(sh("gh", ["release", "view", tag, "--json", "assets", "--jq",
    '"assets: " + ([.assets[].name] | join(", "))']));
  console.log(`\nOK: Release ${tag} 已发布`);
}

function run(cmd, args2) {
  const r = spawnSync(cmd, args2, { stdio: "inherit", cwd: repoRoot });
  if (r.status !== 0) fail(`${cmd} ${args2.join(" ")} 失败（exit ${r.status}）`);
}
