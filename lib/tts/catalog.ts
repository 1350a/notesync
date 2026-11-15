/**
 * TTS 引擎静态目录（doc/tts.md §2）：纯常量、无 env 读取、无网络副作用——
 * settings normalize（纯函数链、可脚本直跑）与设置 UI 复用同一份真源；
 * 网络实现在 zhipu.ts / deepseek.ts（仅服务端 route 引用）。
 */

export type TtsEngineId = 'zhipu' | 'deepseek';

/** 音色目录：label 只用官方文档给出的命名，不推断未标注的性别/音色特征 */
export interface TtsVoice {
  id: string;
  label: string;
  /** 引擎默认音色：normalize 回落与引擎切换随迁的锚点（每引擎恰一个） */
  default?: boolean;
}

export interface TtsEngineCatalog {
  id: TtsEngineId;
  label: string;
  /** 单段合成文本上限（原始字符，doc/tts.md §2）：官方上限各留余量 */
  maxSegmentChars: number;
  voices: readonly TtsVoice[];
}

export const TTS_ENGINES: readonly TtsEngineCatalog[] = [
  {
    id: 'zhipu',
    label: '智谱 GLM-TTS',
    // 官方 input maxLength 1024，按 1000 切段留余量（防计费口径差异）
    maxSegmentChars: 1000,
    voices: [
      { id: 'tongtong', label: '彤彤', default: true },
      { id: 'chuichui', label: '锤锤' },
      { id: 'xiaochen', label: '小陈' },
      { id: 'jam', label: 'Jam' },
      { id: 'kazi', label: 'Kazi' },
      { id: 'douji', label: 'Douji' },
      { id: 'luodo', label: 'Luodo' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek TTS',
    // 官方 10000 计费字符且汉字计 2：4000 原始字符在纯 ASCII（4000）与
    // 全汉字（8000）两种口径下都留在官方上限内
    maxSegmentChars: 4000,
    voices: [
      { id: 'stella', label: '海星 Stella（女声）', default: true },
      { id: 'tide', label: '暗潮 Tide（男声）' },
    ],
  },
];

export const TTS_ENGINE_IDS: readonly TtsEngineId[] = TTS_ENGINES.map((engine) => engine.id);

/** 档位类型守卫：替代 `TTS_ENGINE_IDS.includes(v as never)` 一类的断言逃逸 */
export function isTtsEngineId(value: unknown): value is TtsEngineId {
  return typeof value === 'string' && (TTS_ENGINE_IDS as readonly string[]).includes(value);
}

export function getTtsEngine(id: string): TtsEngineCatalog | null {
  return TTS_ENGINES.find((engine) => engine.id === id) ?? null;
}

export function defaultTtsVoice(engineId: TtsEngineId): string {
  const engine = getTtsEngine(engineId);
  return engine?.voices.find((voice) => voice.default)?.id ?? engine?.voices[0]?.id ?? '';
}

export function engineHasVoice(engineId: TtsEngineId, voice: string): boolean {
  return getTtsEngine(engineId)?.voices.some((v) => v.id === voice) ?? false;
}
