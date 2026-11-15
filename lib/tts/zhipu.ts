/**
 * 智谱 GLM-TTS 客户端（doc/tts.md §2）：POST {ZHIPU_BASE_URL}/audio/speech。
 * response_format 必须显式 wav——官方默认 pcm，前端 <audio> 不能直接播；
 * 语速/音量官方支持但 v1 不下发（doc/tts.md §8 挂账）。密钥复用 ZHIPU_API_KEY
 * （OCR 同款），不出服务端（AGENTS.md §7）。
 */
import { TtsError } from './errors.ts';
import { postAudioRequest } from './upstream.ts';

/** 错误文案里的引擎标识 */
export const ZHIPU_TTS_LABEL = '智谱 TTS';

export function zhipuTtsAvailable(): boolean {
  return Boolean(process.env.ZHIPU_API_KEY);
}

export async function zhipuTtsSynthesize(segment: string, voice: string): Promise<ArrayBuffer> {
  const apiKey = process.env.ZHIPU_API_KEY || '';
  const baseUrl = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  // 路由层已做 unconfigured 门禁，此处兜底防直接调用（如冒烟脚本）绕过校验
  if (!apiKey) throw new TtsError('unconfigured', 'ZHIPU_API_KEY 未配置');
  return postAudioRequest({
    url: `${baseUrl}/audio/speech`,
    apiKey,
    body: { model: 'glm-tts', input: segment, voice, response_format: 'wav' },
    label: ZHIPU_TTS_LABEL,
  });
}
