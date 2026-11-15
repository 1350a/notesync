import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetEnvWarnings,
  resolveNonNegativeInt,
  validateEnv,
  warnEnvOnce,
} from '@/lib/config/env.ts';
import { DEFAULT_TRIM_BUDGET_CHARS, resolveTrimBudget } from '@/lib/chat/trim.ts';
import { DEFAULT_TOOL_MAX_ROUNDS, resolveToolMaxRounds } from '@/lib/tools/loop.ts';

/** 用例会改动的环境变量：每个用例前后都清空，避免用例之间互相污染 */
const KEYS = [
  'TRIM_BUDGET_CHARS',
  'TOOL_MAX_ROUNDS',
  'TOOLS_ENABLED',
  'USER_FIELD_ENABLED',
  'CUSTOM_ALLOW_IMAGES',
  'MOCK_MODEL',
  'MOCK_OCR',
  'MOCK_PARSE_DOC',
  'MOCK_IMAGE_MODE',
  'CUSTOM_TOOL_MODE',
  'DEEPSEEK_BASE_URL',
  'ZHIPU_BASE_URL',
  'CUSTOM_BASE_URL',
] as const;

/** 收集到的 warn 文案（只断言"报了几条、报的是谁"，不锁死整句措辞） */
const warns: string[] = [];

function clearEnv() {
  for (const key of KEYS) delete process.env[key];
}

beforeEach(() => {
  warns.length = 0;
  clearEnv();
  resetEnvWarnings();
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearEnv();
  resetEnvWarnings();
});

describe('resolveNonNegativeInt（数值型变量解析，doc/help-about-.env.md §9.1）', () => {
  it('未配置：静默用默认值，不告警', () => {
    expect(resolveNonNegativeInt('TRIM_BUDGET_CHARS', 24000)).toBe(24000);
    expect(warns).toHaveLength(0);
  });

  it('空串与纯空格：视同未配置，不告警', () => {
    process.env.TRIM_BUDGET_CHARS = '   ';
    expect(resolveNonNegativeInt('TRIM_BUDGET_CHARS', 24000)).toBe(24000);
    expect(warns).toHaveLength(0);
  });

  it('0 是合法值，原样采用', () => {
    process.env.TRIM_BUDGET_CHARS = '0';
    expect(resolveNonNegativeInt('TRIM_BUDGET_CHARS', 24000)).toBe(0);
    expect(warns).toHaveLength(0);
  });

  it('正整数原样采用', () => {
    process.env.TRIM_BUDGET_CHARS = '60000';
    expect(resolveNonNegativeInt('TRIM_BUDGET_CHARS', 24000)).toBe(60000);
    expect(warns).toHaveLength(0);
  });

  it('保留 parseInt 的既有语义：带尾缀写法仍解析出数字（行为不变）', () => {
    process.env.TRIM_BUDGET_CHARS = '12k';
    expect(resolveNonNegativeInt('TRIM_BUDGET_CHARS', 24000)).toBe(12);
    expect(warns).toHaveLength(0);
  });

  it('非法值与负数：回落默认并告警一次', () => {
    process.env.TOOL_MAX_ROUNDS = 'abc';
    expect(resolveNonNegativeInt('TOOL_MAX_ROUNDS', 5)).toBe(5);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('TOOL_MAX_ROUNDS');

    process.env.TOOL_MAX_ROUNDS = '-1';
    expect(resolveNonNegativeInt('TOOL_MAX_ROUNDS', 5)).toBe(5);
    // 同一变量只报一次，不随调用次数刷屏
    expect(warns).toHaveLength(1);
  });
});

describe('环境变量接入的两个调用点', () => {
  it('TRIM_BUDGET_CHARS 非法时回落默认预算', () => {
    process.env.TRIM_BUDGET_CHARS = 'abc';
    expect(resolveTrimBudget()).toBe(DEFAULT_TRIM_BUDGET_CHARS);
    expect(warns.some((w) => w.includes('TRIM_BUDGET_CHARS'))).toBe(true);
  });

  it('TOOL_MAX_ROUNDS 非法时回落默认轮数 5（不再是 NaN 等价 0 轮）', () => {
    process.env.TOOL_MAX_ROUNDS = 'abc';
    expect(DEFAULT_TOOL_MAX_ROUNDS).toBe(5);
    expect(resolveToolMaxRounds()).toBe(5);
    expect(warns.some((w) => w.includes('TOOL_MAX_ROUNDS'))).toBe(true);
  });

  it('TOOL_MAX_ROUNDS=0 合法：一轮工具都不执行', () => {
    process.env.TOOL_MAX_ROUNDS = '0';
    expect(resolveToolMaxRounds()).toBe(0);
    expect(warns).toHaveLength(0);
  });
});

describe('validateEnv（启动期校验）', () => {
  it('全部未配置：不告警（没配是正常状态）', () => {
    validateEnv();
    expect(warns).toHaveLength(0);
  });

  it('认可的写法不告警', () => {
    process.env.TOOLS_ENABLED = 'false';
    process.env.MOCK_MODEL = '1';
    process.env.CUSTOM_TOOL_MODE = 'text';
    process.env.CUSTOM_ALLOW_IMAGES = '0';
    process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
    validateEnv();
    expect(warns).toHaveLength(0);
  });

  it('布尔开关写错：指出实际落到的方向', () => {
    process.env.TOOLS_ENABLED = 'False';
    validateEnv();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('TOOLS_ENABLED');
    // 危险方向必须说清：写 False 仍然开启
    expect(warns[0]).toContain('开启');
  });

  it('mock 开关写 true：提示实际并未 mock', () => {
    process.env.MOCK_MODEL = 'true';
    validateEnv();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('MOCK_MODEL');
    expect(warns[0]).toContain('真实调用');
  });

  it('枚举开关大小写写错也会被指出', () => {
    process.env.CUSTOM_TOOL_MODE = 'Text';
    validateEnv();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('CUSTOM_TOOL_MODE');
  });

  it('Base URL 缺协议或带引号：提示请求会失败', () => {
    process.env.CUSTOM_BASE_URL = 'api.deepseek.com/v1';
    validateEnv();
    expect(warns.some((w) => w.includes('CUSTOM_BASE_URL'))).toBe(true);
  });

  it('Base URL 合法不告警', () => {
    process.env.ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
    validateEnv();
    expect(warns).toHaveLength(0);
  });
});

describe('warnEnvOnce（去重）', () => {
  it('同一 key 只报一次，reset 后可再报', () => {
    warnEnvOnce('FOO', '第一次');
    warnEnvOnce('FOO', '第二次');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('第一次');

    resetEnvWarnings();
    warnEnvOnce('FOO', '第三次');
    expect(warns).toHaveLength(2);
  });

  it('不同 key 互不影响', () => {
    warnEnvOnce('FOO', 'a');
    warnEnvOnce('BAR', 'b');
    expect(warns).toHaveLength(2);
  });
});
