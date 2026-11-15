/*
 * DeepSeek safety_check 服务端内容安全审核（safety-protocol.md §3.2）用例
 *
 * 覆盖三件事：档位解析（env 开关收敛）、请求体映射（未配置不发送）、
 * 输入未过审 400 的识别与错误类型归一（UpstreamContentBlockedError）。
 */
import { describe, expect, it } from 'vitest';
import {
  isContentExistsRisk,
  mapSafetyCheckParam,
} from '../../../lib/provider/openaiCompat.ts';
import { resolveSafetyCheck } from '../../../lib/provider/deepseek.ts';
import { UpstreamContentBlockedError } from '../../../lib/provider/errors.ts';

describe('resolveSafetyCheck（DEEPSEEK_SAFETY_CHECK 收敛，严格字符串比较）', () => {
  it('high：认可值原样采用', () => {
    expect(resolveSafetyCheck('high')).toBe('high');
  });

  it('low / off / 未配置 / 空串：不发送（官方口径 low 即 API 默认内容检查，与不传相同）', () => {
    expect(resolveSafetyCheck('low')).toBeUndefined();
    expect(resolveSafetyCheck('off')).toBeUndefined();
    expect(resolveSafetyCheck(undefined)).toBeUndefined();
    expect(resolveSafetyCheck('')).toBeUndefined();
  });

  it('大小写不归一：填错留痕交给 validateEnv，这里只按认可值收敛', () => {
    expect(resolveSafetyCheck('High')).toBeUndefined();
    expect(resolveSafetyCheck('HIGH')).toBeUndefined();
    expect(resolveSafetyCheck('on')).toBeUndefined();
  });
});

describe('mapSafetyCheckParam（safety_check 请求体映射）', () => {
  it('high：下发 { safety_check: { level: "high" } }', () => {
    expect(mapSafetyCheckParam('high')).toEqual({ safety_check: { level: 'high' } });
  });

  it('未配置：不携带该字段（智谱 / 自定义端点未知字段严格校验风险）', () => {
    expect(mapSafetyCheckParam(undefined)).toBeNull();
  });
});

describe('isContentExistsRisk（输入未过审 400 识别）', () => {
  it('400 + 固定短语：命中（大小写不敏感）', () => {
    expect(
      isContentExistsRisk(400, '{"error":{"message":"Content Exists Risk: your input triggered moderation"}}'),
    ).toBe(true);
    expect(isContentExistsRisk(400, 'content exists risk')).toBe(true);
  });

  it('非 400 或其他错误文案：不命中，保持普通 provider_error 语义', () => {
    expect(isContentExistsRisk(401, 'Content Exists Risk')).toBe(false);
    expect(isContentExistsRisk(400, 'Invalid model name')).toBe(false);
    expect(isContentExistsRisk(429, 'rate limit')).toBe(false);
  });
});

describe('UpstreamContentBlockedError（拦截语义归一）', () => {
  it('instanceof 可判定，name 与 status 固化', () => {
    const err = new UpstreamContentBlockedError('DeepSeek 返回错误（HTTP 400）');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UpstreamContentBlockedError);
    expect(err.name).toBe('UpstreamContentBlockedError');
    expect(err.status).toBe(400);
  });
});
