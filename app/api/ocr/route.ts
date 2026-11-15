/**
 * POST /api/ocr —— 云端 OCR 转写代理（doc/cloud-ocr.md §5）
 *
 * 服务端只做校验与委托（AGENTS.md §2）：glm-ocr 走独立 layout_parsing 端点
 * （非 chat/completions），密钥不出服务端，图片不落盘、不打图片日志。
 * 单图单请求：并发调度与逐张进度由客户端负责（与本地引擎粒度一致）。
 *
 * MOCK_OCR=1 时不碰上游、不校验密钥，直接返回占位文本——零 token 验证接线，
 * 与 diagnose-file-intake.md §8 的 MOCK_MODEL=1 同思路。
 */
import {
  CloudOcrError,
  CLOUD_OCR_MAX_IMAGE_BYTES,
  cloudOcrAvailable,
  cloudOcrRecognize,
  decodedByteLength,
  parseImageDataUrl,
} from "@/lib/ocr/cloud";

/** 统一错误响应：code 与 doc/cloud-ocr.md §5 错误码表对齐 */
function ocrError(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ocrError(400, "invalid_request", "请求体不是合法 JSON");
  }

  const image =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).image
      : undefined;
  const parsed = parseImageDataUrl(image);
  if (!parsed) {
    return ocrError(
      400,
      "invalid_request",
      "image 必须是 data:image/(png|jpeg|jpg);base64, 前缀的 dataUrl（云端OCR仅支持 JPG/PNG）",
    );
  }

  if (process.env.MOCK_OCR === "1") {
    return Response.json({
      text: "[MOCK]云端OCR转写占位（MOCK_OCR=1，未调用上游）",
      layoutDetails: [],
    });
  }

  if (!cloudOcrAvailable()) {
    return ocrError(503, "unconfigured", "ZHIPU_API_KEY 未配置，云端 OCR 不可用");
  }

  if (decodedByteLength(parsed.base64) > CLOUD_OCR_MAX_IMAGE_BYTES) {
    return ocrError(413, "image_too_large", "图片超过 10MB（glm-ocr 单图上限），请压缩后重试");
  }

  try {
    const result = await cloudOcrRecognize(parsed);
    return Response.json(result);
  } catch (err) {
    if (err instanceof CloudOcrError) {
      const status = err.code === "parse_error" ? 500 : 502;
      return ocrError(status, err.code, err.message);
    }
    // 防御分支：库内错误都已映射，走到这里说明有未预期异常，原样摘要进日志
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[ocr] unexpected: ${reason}`);
    return ocrError(500, "parse_error", "云端 OCR 发生未预期错误");
  }
}
