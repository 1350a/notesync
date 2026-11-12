/**
 * 上游错误原文脱敏用例（对应审查项 S2）。
 *
 * 实测证据：真实 402 响应体为
 * `{"error":{"message":"Insufficient Balance (request_id: 928791ca-...)"}}`，
 * 修复前这段原文被整段拼进 SSE error 事件下发到浏览器。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ERROR_LOG_CHARS,
  MAX_ERROR_SUMMARY_CHARS,
  extractUpstreamMessage,
  redactUpstreamText,
} from '@/lib/safety/redact';

describe('redactUpstreamText', () => {
  it('抹掉 UUID 形态的 request_id', () => {
    const out = redactUpstreamText(
      'Insufficient Balance (request_id: 928791ca-5c85-44a0-a0e9-46997162c4c3)',
    );
    expect(out).not.toContain('928791ca');
    expect(out).toContain('[id]');
    // 语义短语保留，方便用户与排错对齐
    expect(out).toContain('Insufficient Balance');
  });

  it('抹掉键值对形态的追踪标识', () => {
    const out = redactUpstreamText('failed, trace_id=abc123def456, please retry');
    expect(out).not.toContain('abc123def456');
    expect(out).toContain('[id]');
  });

  it('抹掉邮箱与密钥形态', () => {
    const out = redactUpstreamText('account user@example.com key sk-abcdef1234567890 invalid');
    expect(out).not.toContain('user@example.com');
    expect(out).not.toContain('sk-abcdef1234567890');
    expect(out).toContain('[email]');
    expect(out).toContain('[key]');
  });

  it('抹掉长 hex 串（疑似签名或令牌）', () => {
    const token = 'a'.repeat(40);
    const out = redactUpstreamText(`signature ${token} mismatch`);
    expect(out).not.toContain(token);
    expect(out).toContain('[token]');
  });

  it('压平换行与多余空白，避免大段 JSON 全进前端', () => {
    const out = redactUpstreamText('{\n  "error": {\n    "message": "boom"\n  }\n}');
    expect(out).not.toContain('\n');
    expect(out).toContain('"message": "boom"');
  });

  it('超过摘要上限时截断到 200 字符', () => {
    const out = redactUpstreamText('x'.repeat(5000));
    expect(out).toHaveLength(MAX_ERROR_SUMMARY_CHARS);
  });

  it('截断发生在替换之后：末尾的 UUID 不会被切成无法识别的残片', () => {
    const out = redactUpstreamText(`${'y'.repeat(150)} 928791ca-5c85-44a0-a0e9-46997162c4c3`);
    expect(out).not.toContain('928791ca');
    expect(out).toContain('[id]');
  });

  it('空输入返回空串（调用方据此决定是否省略摘要）', () => {
    expect(redactUpstreamText('')).toBe('');
  });
});

describe('extractUpstreamMessage', () => {
  it('只取 error.message，不带上游的 type / param / code 字段', () => {
    const raw =
      '{"error":{"message":"Insufficient Balance (request_id: 928791ca-5c85-44a0-a0e9-46997162c4c3)","type":"insufficient_balance_error","param":null,"code":"invalid_request_error"}}';
    const out = extractUpstreamMessage(raw);
    expect(out).toContain('Insufficient Balance');
    expect(out).not.toContain('insufficient_balance_error');
    expect(out).not.toContain('"code"');
  });

  it('兼容 error 为字符串、顶层 message / msg 三种形态', () => {
    expect(extractUpstreamMessage('{"error":"boom"}')).toBe('boom');
    expect(extractUpstreamMessage('{"message":"boom"}')).toBe('boom');
    expect(extractUpstreamMessage('{"msg":"boom"}')).toBe('boom');
  });

  it('非 JSON（网关 HTML / 纯文本）退回原文，语义不丢', () => {
    expect(extractUpstreamMessage('<html>502 Bad Gateway</html>')).toBe('<html>502 Bad Gateway</html>');
  });

  it('JSON 里取不到 message 时退回原文，不做二次编造', () => {
    const raw = '{"foo":1}';
    expect(extractUpstreamMessage(raw)).toBe(raw);
  });

  it('空输入返回空串', () => {
    expect(extractUpstreamMessage('')).toBe('');
  });

  it('与脱敏串联后：语义保留、标识抹掉', () => {
    const raw =
      '{"error":{"message":"Invalid Key sk-abcdef1234567890 for user@example.com","code":"auth"}}';
    const out = redactUpstreamText(extractUpstreamMessage(raw));
    expect(out).toContain('Invalid Key');
    expect(out).not.toContain('sk-abcdef1234567890');
    expect(out).not.toContain('user@example.com');
  });
});

describe('日志侧长度上限', () => {
  it('留出比响应摘要更宽的余量（完整原文进日志）', () => {
    expect(MAX_ERROR_LOG_CHARS).toBeGreaterThan(MAX_ERROR_SUMMARY_CHARS);
    expect(MAX_ERROR_LOG_CHARS).toBe(2000);
  });
});
