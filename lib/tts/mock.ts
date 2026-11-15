/**
 * MOCK_TTS 占位音频（doc/tts.md §6）：每段固定短静音 wav（24000Hz/16bit/mono
 * 约 0.05s）。mock 模式下清洗与分段照常执行，仅音频内容为占位——验证的是
 * 「清洗 → 分段 → 响应结构 → 前端队列播放」全链（零成本，与 MOCK_OCR 同思路）。
 */

const SAMPLE_RATE = 24_000;
/** 0.05s × 24000Hz：足够让 <audio> 触发 play/ended 全周期，又不拖慢冒烟 */
const MOCK_SAMPLES = 1_200;
const PCM_BYTES = MOCK_SAMPLES * 2; // 16bit mono

/** 44 字节标准 PCM WAV 头 + 静音数据段；返回 ArrayBuffer 与真实引擎合成产物同型，
 * 供 SegmentSynthesizer 直接注入；纯函数，用例可断言头部魔数与字段 */
export function buildMockWav(): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + PCM_BYTES);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + PCM_BYTES, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 块长
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, PCM_BYTES, true);
  // 数据段全零 = 静音；ArrayBuffer 默认即 0，不再写
  return buffer;
}

/** 服务端出 base64（Node Buffer；仅 route 在 node runtime 引用） */
export function toWavBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
