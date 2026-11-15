/**
 * GET/POST /api/tts —— TTS 朗读代理（doc/tts.md §6）
 *
 * GET 返回引擎可用性布尔表（key 是否配置），设置页禁用未配置引擎用。
 * POST 只做校验与委托（AGENTS.md §2）：清洗/分段/逐段合成全在 lib/tts；
 * 密钥不出服务端，文本不落盘、不打正文日志（与 chat/ocr 同口径）。
 *
 * MOCK_TTS=1 时不碰上游、不校验密钥：清洗与分段照常执行，每段返回固定
 * 静音占位——零成本验证「清洗 → 分段 → 响应结构 → 前端队列播放」全链，
 * 与 MOCK_OCR=1 同思路（doc/tts.md §6）。
 */
import {
  buildMockWav,
  isTtsEngineId,
  synthesizeSpeech,
  ttsEngineAvailable,
  TTS_MAX_RAW_CHARS,
  engineHasVoice,
  TtsError,
  type TtsEngineId,
  type TtsErrorCode,
} from "@/lib/tts";

/** 统一错误响应：code 与 doc/tts.md §6 错误码表对齐 */
function ttsError(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

/** lib 层错误码 → HTTP 状态（doc/tts.md §6 错误码表） */
const STATUS_BY_CODE: Record<TtsErrorCode, number> = {
  invalid_request: 400,
  engine_unknown: 400,
  voice_invalid: 400,
  empty_text: 400,
  text_too_long: 413,
  unconfigured: 503,
  provider_error: 502,
  rate_limited: 429,
};

export async function GET() {
  const engines: Record<TtsEngineId, boolean> = {
    zhipu: ttsEngineAvailable("zhipu"),
    deepseek: ttsEngineAvailable("deepseek"),
  };
  return Response.json({ engines });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ttsError(400, "invalid_request", "请求体不是合法 JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ttsError(400, "invalid_request", "请求体必须是 JSON 对象");
  }
  const record = body as Record<string, unknown>;

  const text = record.text;
  if (typeof text !== "string" || text.length === 0) {
    return ttsError(400, "invalid_request", "text 必须是非空字符串");
  }
  if (text.length > TTS_MAX_RAW_CHARS) {
    return ttsError(400, "invalid_request", `text 超过 ${TTS_MAX_RAW_CHARS} 字符原始上限`);
  }
  if (!isTtsEngineId(record.engine)) {
    return ttsError(400, "engine_unknown", "engine 必须是 zhipu 或 deepseek");
  }
  const engine = record.engine;
  if (typeof record.voice !== "string" || !engineHasVoice(engine, record.voice)) {
    return ttsError(400, "voice_invalid", `音色与引擎不匹配（${engine}）`);
  }
  const voice = record.voice;

  // mock 模式注入占位合成器：清洗/分段/防呆门禁照常执行，仅音频为占位
  const mock = process.env.MOCK_TTS === "1";
  if (!mock && !ttsEngineAvailable(engine)) {
    return ttsError(503, "unconfigured", `引擎 ${engine} 的 API Key 未配置，朗读不可用`);
  }

  try {
    const segments = await synthesizeSpeech(text, engine, voice, mock ? async () => buildMockWav() : undefined);
    return Response.json({ segments });
  } catch (err) {
    if (err instanceof TtsError) {
      return ttsError(STATUS_BY_CODE[err.code], err.code, err.message);
    }
    // 防御分支：库内错误都已映射，走到这里说明有未预期异常，原样摘要进日志
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[tts] unexpected: ${reason}`);
    return ttsError(500, "provider_error", "朗读合成发生未预期错误");
  }
}
