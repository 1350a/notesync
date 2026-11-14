/**
 * Office 文档客户端解析（doc/file-intake.md §7）
 *
 * 全部动态 import：选中对应文件才拉对应库，不进首屏 bundle。
 * 输出纯文本；失败不抛错，降级为空文本 + warning（与 diagnose-file-intake.md
 * §4 单文件失败不拖垮整批同口径）。不用 DOMParser：pptx 的 slide XML 只有
 * 五类实体转义，手写解码可在 Node 单测/冒烟里直跑。
 */
import type { OfficeFormat } from './detect.ts';

export interface OfficeExtractResult {
  text: string;
  /** 未提取到内容 / 截断 / 解析失败的降级原因 */
  warning?: string;
}

/** XML 五类实体 + 数字/十六进制字符引用解码 */
function decodeXmlEntities(input: string): string {
  return input.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_match, code: string) => {
    if (code === 'amp') return '&';
    if (code === 'lt') return '<';
    if (code === 'gt') return '>';
    if (code === 'quot') return '"';
    if (code === 'apos') return "'";
    if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    return String.fromCodePoint(parseInt(code.slice(1), 10));
  });
}

function slideNumber(path: string): number {
  return Number.parseInt(path.replace(/^ppt\/slides\/slide(\d+)\.xml$/, '$1'), 10) || 0;
}

/** docx → 纯文本（extractRawText 保留段落换行，表格按文档顺序输出单元格文字） */
async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  // mammoth 的 Node 构建只吃 path/buffer、浏览器构建吃 arrayBuffer：
  // 生产环境是浏览器，但单测在 Node 直跑同一代码路径，按环境给输入形态
  const input =
    typeof Buffer !== 'undefined'
      ? { buffer: Buffer.from(arrayBuffer) }
      : { arrayBuffer };
  const result = await mammoth.extractRawText(input);
  return result.value;
}

/** pptx → 按页分组文本：抽 ppt/slides/slideN.xml 的 <a:t> 文本 run */
async function extractPptxText(file: File, maxChars: number): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  let out = '';
  for (const path of slidePaths) {
    const entry = zip.file(path);
    if (!entry) continue;
    const xml = await entry.async('string');
    // 段落以 </a:p> 收尾；段内 <a:t> 是行内碎片，直接拼接不加空格
    const paragraphs = xml
      .split('</a:p>')
      .map((chunk) => {
        let runs = '';
        for (const match of chunk.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)) {
          runs += decodeXmlEntities(match[1] ?? '');
        }
        return runs.trim();
      })
      .filter(Boolean);
    if (paragraphs.length === 0) continue;
    out += `【第 ${slideNumber(path)} 页】\n${paragraphs.join('\n')}\n`;
    if (out.length >= maxChars) break;
  }
  return out;
}

/**
 * 统一入口：按 format 分发到对应解析器，超限截断留 warning。
 * xlsx/xls 已于 2026-11-14 暂缓（detect 层拒收引导转 CSV，file-intake.md §10）。
 * maxChars 由调用方按入口传入（聊天 200_000 / 诊断 20_000，file-intake.md §7）。
 */
export async function extractOfficeText(
  file: File,
  format: OfficeFormat,
  maxChars: number
): Promise<OfficeExtractResult> {
  try {
    const text =
      format === 'docx'
        ? await extractDocxText(file)
        : await extractPptxText(file, maxChars);
    const trimmed = text.trim();
    if (!trimmed) return { text: '', warning: '未提取到文字内容' };
    if (trimmed.length > maxChars) {
      return { text: trimmed.slice(0, maxChars), warning: `内容超过 ${maxChars} 字符，已截断` };
    }
    return { text: trimmed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: '', warning: `解析失败：${message}` };
  }
}
