/**
 * POST /api/parse-doc —— 旧版 Word (.doc) 解析端点（doc/file-intake.md §8）
 *
 * 服务端只做校验与委托（AGENTS.md §2）：word-extractor 解析后返回纯文本，
 * 不落盘、不打正文日志。错误码与错误体形态对齐 /api/ocr 风格。
 *
 * MOCK_PARSE_DOC=1 时不碰解析库，直接返回占位文本——零依赖验证接线。
 */
import { ParseDocError, parseDocBuffer, parseDocDataUrl } from '@/lib/parse/doc';

function docError(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return docError(400, 'invalid_request', '请求体不是合法 JSON');
  }

  const fields =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const { dataUrl, name } = fields;
  if (typeof dataUrl !== 'string' || !dataUrl) {
    return docError(400, 'invalid_request', 'dataUrl 必须是 base64 编码的 dataUrl 字符串');
  }

  if (process.env.MOCK_PARSE_DOC === '1') {
    return Response.json({
      text: `[MOCK]doc 解析占位（MOCK_PARSE_DOC=1，未调用解析库）${typeof name === 'string' ? `：${name}` : ''}`,
    });
  }

  let buffer: Buffer;
  try {
    buffer = parseDocDataUrl(dataUrl);
  } catch (err) {
    if (err instanceof ParseDocError) {
      const status = err.code === 'too_large' ? 413 : 400;
      return docError(status, err.code, err.message);
    }
    return docError(400, 'invalid_request', 'dataUrl 解码失败');
  }

  try {
    const text = await parseDocBuffer(buffer);
    return Response.json({ text });
  } catch (err) {
    if (err instanceof ParseDocError) {
      return docError(500, err.code, err.message);
    }
    // 防御分支：库内错误都已映射，走到这里说明有未预期异常
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[parse-doc] unexpected: ${reason}`);
    return docError(500, 'parse_error', '文档解析发生未预期错误');
  }
}
