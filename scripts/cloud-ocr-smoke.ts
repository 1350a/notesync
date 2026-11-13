/*
 * 云端 OCR 冒烟（doc/cloud-ocr.md §8）：对一张本地图片直调 glm-ocr（layout_parsing），
 * 验证 base64 直传兼容性与转写质量，结论回填协议 §2。
 *
 * 用法：node --experimental-strip-types scripts/cloud-ocr-smoke.ts <图片路径>
 * 图片可用 PowerShell System.Drawing 生成（见 doc/cloud-ocr.md §8 记录）；
 * JPG 自备图请自行把 dataUrl 前缀改成 data:image/jpeg。
 *
 * 测试图生成（Git Bash）：
 *   powershell -Command "Add-Type -AssemblyName System.Drawing; \
 *     $b=New-Object System.Drawing.Bitmap(560,140); \
 *     $g=[System.Drawing.Graphics]::FromImage($b); \
 *     $g.Clear('White'); \
 *     $g.DrawString('已知函数 f(x)=2x+1，求它的导数。', (New-Object System.Drawing.Font('Microsoft YaHei',18)), [System.Drawing.Brushes]::Black, 20, 50); \
 *     $b.Save('scripts\.ocr-smoke-fixture.png')"
 */
import { readFileSync, existsSync } from "node:fs";

/** node 不自动加载 .env：冒烟脚本自行兜底解析（仅缺 key 时），密钥不打印 */
function ensureZhipuEnv(): void {
  if (process.env.ZHIPU_API_KEY) return;
  const envPath = new URL("../.env", import.meta.url);
  if (!existsSync(envPath)) {
    console.error("FAIL: ZHIPU_API_KEY 未设置且找不到 .env");
    process.exit(1);
  }
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error("用法: node --experimental-strip-types scripts/cloud-ocr-smoke.ts <图片路径>");
    process.exit(1);
  }

  ensureZhipuEnv();
  const { cloudOcrRecognize, parseImageDataUrl, decodedByteLength } = await import(
    "../lib/ocr/cloud.ts"
  );

  const bytes = readFileSync(imagePath);
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    console.error("FAIL: dataUrl 解析失败（前缀校验未过）");
    process.exit(1);
  }
  const sizeKb = decodedByteLength(parsed.base64) / 1024;
  console.log(`图片: ${imagePath}（${sizeKb.toFixed(1)} KB）`);

  const started = Date.now();
  try {
    const result = await cloudOcrRecognize(parsed.base64);
    console.log(`耗时 ${Date.now() - started}ms，md_results ${result.text.length} 字符`);
    console.log("--- md_results ---");
    console.log(result.text || "(空)");
    if (!result.text.trim()) {
      console.error("FAIL: 识别结果为空——base64 兼容性存疑，检查上游响应");
      process.exit(1);
    }
    console.log("PASS: base64 直传兼容，转写链路可用");
  } catch (err) {
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
