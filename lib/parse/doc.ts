/**
 * 旧版 Word (.doc) 服务端解析（doc/file-intake.md §8）
 *
 * .doc 是 OLE 复合二进制，浏览器端无解；word-extractor 为纯 JS 实现
 * （无原生依赖），只在 Node 侧调用。内容不落盘、不打正文日志。
 */
import { isOleCompoundFile } from '../intake/detect.ts';
import WordExtractor from 'word-extractor';

/** 解码后字节上限：.doc 实际场景远小于此，防请求体滥用 */
export const PARSE_DOC_MAX_BYTES = 20 * 1024 * 1024;

export type ParseDocErrorCode = 'unsupported_format' | 'too_large' | 'parse_error';

// 显式字段声明而非构造器参数属性：node --experimental-strip-types 不转换
// 参数属性语法（scripts/file-intake-smoke.ts 会直跑本模块）
export class ParseDocError extends Error {
  readonly code: ParseDocErrorCode;

  constructor(code: ParseDocErrorCode, message: string) {
    super(message);
    this.name = 'ParseDocError';
    this.code = code;
  }
}

/**
 * dataUrl → Buffer：剥离 data:*;base64, 前缀（具体 MIME 不强校验，
 * 以 OLE 魔数为准）、校验大小与魔数。任何不符都抛 ParseDocError。
 */
export function parseDocDataUrl(dataUrl: string): Buffer {
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]*)$/.exec(dataUrl.trim());
  if (!match) {
    throw new ParseDocError('unsupported_format', 'dataUrl 必须是 base64 编码的 dataUrl');
  }
  const buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) {
    throw new ParseDocError('unsupported_format', 'dataUrl 解码后为空');
  }
  if (buffer.length > PARSE_DOC_MAX_BYTES) {
    throw new ParseDocError(
      'too_large',
      `文档超过 ${Math.floor(PARSE_DOC_MAX_BYTES / 1024 / 1024)}MB 上限`
    );
  }
  // 魔数复验：伪装成 .doc 的其他文件在这里拦下（file-intake.md §8）
  if (!isOleCompoundFile(buffer)) {
    throw new ParseDocError('unsupported_format', '不是有效的旧版 Word 文档（OLE 魔数不符）');
  }
  return buffer;
}

/** Buffer → 正文文本；空文档返回空串，由调用方决定降级文案 */
export async function parseDocBuffer(buffer: Buffer): Promise<string> {
  const extractor = new WordExtractor();
  try {
    const doc = await extractor.extract(buffer);
    return doc.getBody();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ParseDocError('parse_error', `旧版 Word 解析失败：${reason}`);
  }
}
