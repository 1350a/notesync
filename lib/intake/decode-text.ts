/**
 * 文本文件编码探测（doc/file-intake.md §4）
 *
 * 取代两入口原有的 file.text()（按 UTF-8 硬解，GBK/GB18030/UTF-16 必乱码）。
 * 零依赖：浏览器与 Node（≥18 全量 ICU）的 TextDecoder 原生支持 gb18030 等
 * 扩展编码。纯函数，单测直接喂 Node Buffer 构造的样本。
 */

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';

export type DecodedText =
  | { ok: true; text: string; encoding: TextEncoding }
  | { ok: false; reason: string };

/** NUL 字节占比超过该阈值判为二进制文件：正常文本（含 UTF-16 带 BOM）不含 NUL 段 */
const NUL_RATIO_BINARY = 0.01;

function decodeWith(label: TextEncoding, bytes: Uint8Array, fatal = false): string {
  return new TextDecoder(label, { fatal }).decode(bytes);
}

/**
 * ArrayBuffer → 解码结果。顺序（doc/file-intake.md §4）：
 * BOM → 无 BOM 严格 UTF-8 试解 → 失败落 GB18030 兜底（GBK 超集）。
 * Latin-1/Shift_JIS 等无 BOM 单字节编码会被 GB18030 误判为乱码，
 * 属已知取舍（中文场景优先，file-intake.md §10 挂账）。
 */
export function decodeTextBuffer(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return { ok: true, text: '', encoding: 'utf-8' };

  // 1. BOM：显式声明优先
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { ok: true, text: decodeWith('utf-8', bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { ok: true, text: decodeWith('utf-16le', bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { ok: true, text: decodeWith('utf-16be', bytes.subarray(2)), encoding: 'utf-16be' };
  }

  // 2. 二进制防线：NUL 占比超阈值不产出乱码文本，直接拒收
  let nulCount = 0;
  for (const byte of bytes) {
    if (byte === 0) nulCount += 1;
  }
  if (nulCount / bytes.length > NUL_RATIO_BINARY) {
    return { ok: false, reason: '疑似二进制文件，无法按文本读取' };
  }

  // 3. 严格 UTF-8 试解：任何非法序列都抛错，避免静默替换符毁掉整份内容
  try {
    return { ok: true, text: decodeWith('utf-8', bytes, true), encoding: 'utf-8' };
  } catch {
    // 4. GB18030 兜底：GBK 的超集，非法序列以替换符呈现（真实 GBK 文件不会命中）
    return { ok: true, text: decodeWith('gb18030', bytes), encoding: 'gb18030' };
  }
}

/** File 便捷封装：读全量字节后探测 */
export async function decodeTextFile(file: File): Promise<DecodedText> {
  return decodeTextBuffer(await file.arrayBuffer());
}
