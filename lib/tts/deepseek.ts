/**
 * DeepSeek TTS 客户端（doc/tts.md §2）：POST {DEEPSEEK_BASE_URL}/v1/tools/tts。
 * chat 路径挂在根下（baseUrl 不带 /v1），TTS 端点路径自带 /v1 前缀；
 * filter_markdown 不传——清洗统一在本仓库做（doc/tts.md §3，避免双规则口径漂移）；
 * 无语速参数（官方明确不支持）；format=wav（pcm/opus 仅 WS 流式，本协议不接 WS）。
 */
import { TtsError } from './errors.ts';
import { postAudioRequest } from './upstream.ts';

/** 错误文案里的引擎标识 */
export const DEEPSEEK_TTS_LABEL = 'DeepSeek TTS';

export function deepseekTtsAvailable(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export async function deepseekTtsSynthesize(segment: string, voice: string): Promise<ArrayBuffer> {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  // 路由层已做 unconfigured 门禁，此处兜底防直接调用（如冒烟脚本）绕过校验
  if (!apiKey) throw new TtsError('unconfigured', 'DEEPSEEK_API_KEY 未配置');
  return postAudioRequest({
    url: `${baseUrl}/v1/tools/tts`,
    apiKey,
    body: { text: segment, voice_id: voice, format: 'wav' },
    label: DEEPSEEK_TTS_LABEL,
  });
}
