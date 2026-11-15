/**
 * TTS 聚合路由与编排（doc/tts.md §2/§4/§6）：清洗 → 防呆检查 → 分段 →
 * 逐段串行合成 → base64 段数组。未知引擎 id 报 engine_unknown（不静默回落，
 * 与 lib/provider resolveProvider 同口径）；任一段失败整批失败。
 */
import { engineHasVoice, getTtsEngine, type TtsEngineId } from './catalog.ts';
import { cleanSpeechText } from './clean.ts';
import { deepseekTtsAvailable, deepseekTtsSynthesize } from './deepseek.ts';
import { TtsError } from './errors.ts';
import { toWavBase64 } from './mock.ts';
import { MAX_SPEECH_SEGMENTS, MAX_SPEECH_TOTAL_CHARS, splitSpeechSegments } from './segments.ts';
import { zhipuTtsAvailable, zhipuTtsSynthesize } from './zhipu.ts';

export {
  TTS_ENGINES,
  TTS_ENGINE_IDS,
  isTtsEngineId,
  defaultTtsVoice,
  engineHasVoice,
  getTtsEngine,
} from './catalog.ts';
export type { TtsEngineId, TtsVoice, TtsEngineCatalog } from './catalog.ts';
export { cleanSpeechText } from './clean.ts';
export { TtsError } from './errors.ts';
export type { TtsErrorCode } from './errors.ts';
export { buildMockWav, toWavBase64 } from './mock.ts';
export { MAX_SPEECH_SEGMENTS, MAX_SPEECH_TOTAL_CHARS, splitSpeechSegments } from './segments.ts';

/** 单段合成产物（doc/tts.md §6）：格式统一 wav，前端 <audio> 原生播放 */
export interface TtsSegment {
  mime: 'audio/wav';
  base64: string;
}

/** POST text 的原始长度门禁（清洗前的粗防线；清洗后另有 §4 防呆上限） */
export const TTS_MAX_RAW_CHARS = 100_000;

interface EngineImpl {
  available(): boolean;
  synthesize(segment: string, voice: string): Promise<ArrayBuffer>;
}

const ENGINES: Record<TtsEngineId, EngineImpl> = {
  zhipu: { available: zhipuTtsAvailable, synthesize: zhipuTtsSynthesize },
  deepseek: { available: deepseekTtsAvailable, synthesize: deepseekTtsSynthesize },
};

/** 引擎可用性 = 对应 key 环境变量非空（GET /api/tts 布尔表用） */
export function ttsEngineAvailable(id: TtsEngineId): boolean {
  return ENGINES[id].available();
}

/** 单段合成器签名：默认走引擎实现；MOCK_TTS 由 route 注入占位实现（全链门禁不变） */
export type SegmentSynthesizer = (segment: string, voice: string) => Promise<ArrayBuffer>;

export async function synthesizeSpeech(
  text: string,
  engineId: TtsEngineId,
  voice: string,
  synthesize?: SegmentSynthesizer,
): Promise<TtsSegment[]> {
  const engine = getTtsEngine(engineId);
  if (!engine) throw new TtsError('engine_unknown', `未知朗读引擎：${engineId}`);
  if (!engineHasVoice(engineId, voice)) {
    throw new TtsError('voice_invalid', `音色 ${voice} 不属于引擎 ${engineId}`);
  }

  const cleaned = cleanSpeechText(text);
  if (!cleaned) {
    throw new TtsError('empty_text', '这条消息没有可朗读的内容（可能只有代码块、公式或链接）');
  }
  if (cleaned.length > MAX_SPEECH_TOTAL_CHARS) {
    throw new TtsError('text_too_long', `可朗读文本超过 ${MAX_SPEECH_TOTAL_CHARS} 字符上限，请改用更短的内容`);
  }

  const segments = splitSpeechSegments(cleaned, engine.maxSegmentChars);
  if (segments.length > MAX_SPEECH_SEGMENTS) {
    throw new TtsError('text_too_long', `朗读分段超过 ${MAX_SPEECH_SEGMENTS} 段上限，请改用更短的内容`);
  }

  // 串行合成：段序稳定、天然限流；任一段失败整批失败（播放中断比明确报错更糟）
  const synth = synthesize ?? ((segment, voiceId) => ENGINES[engineId].synthesize(segment, voiceId));
  const out: TtsSegment[] = [];
  for (const segment of segments) {
    const audio = await synth(segment, voice);
    out.push({ mime: 'audio/wav', base64: toWavBase64(new Uint8Array(audio)) });
  }
  return out;
}
