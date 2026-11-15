import { describe, expect, it } from 'vitest';
import { buildMockWav } from '../../../lib/tts/mock.ts';

/*
 * MOCK_TTS 占位音频（doc/tts.md §6）：固定短静音 wav。用例锁定头部魔数与
 * 关键字段，防改采样率/位深时前端播放行为漂移。
 */
describe('buildMockWav：占位 wav 头部', () => {
  const wav = buildMockWav();
  const view = new DataView(wav);
  const bytes = () => new Uint8Array(wav);

  it('RIFF/WAVE 魔数与 fmt/data 块标识齐全', () => {
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(new TextDecoder().decode(wav.slice(12, 16))).toBe('fmt ');
    expect(new TextDecoder().decode(wav.slice(36, 40))).toBe('data');
  });

  it('PCM 16bit 单声道 24000Hz，数据段全零（静音）', () => {
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(wav.byteLength - 44);
    expect(bytes().slice(44).every((b) => b === 0)).toBe(true);
  });

  it('RIFF 块长与文件长度一致', () => {
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
  });
});
