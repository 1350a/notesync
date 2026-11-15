/**
 * TTS 链路错误（doc/tts.md §6 错误码表）：lib 层抛出，route 层映射 HTTP 状态。
 * invalid_request / engine_unknown / voice_invalid 由 route 校验直接产生，不从这抛；
 * empty_text / text_too_long 在 index.ts 编排中抛出；unconfigured 由引擎实现兜底抛。
 */
export type TtsErrorCode =
  | 'invalid_request'
  | 'engine_unknown'
  | 'voice_invalid'
  | 'empty_text'
  | 'text_too_long'
  | 'unconfigured'
  | 'provider_error'
  | 'rate_limited';

export class TtsError extends Error {
  readonly code: TtsErrorCode;

  constructor(code: TtsErrorCode, message: string) {
    super(message);
    this.name = 'TtsError';
    this.code = code;
  }
}
