/**
 * 工具层冒烟测试（Node 24 原生 strip-types，零依赖直跑）
 *
 * 运行：`npm run smoke:tools`
 * 或：  `node scripts/tool-smoke.ts`
 *
 * 覆盖：
 * 1. ask_user 正常调用 → awaiting_user
 * 2. ask_user 空 question → 参数校验失败
 * 3. 未知工具 → 错误包装
 * 4. 工具超时 → 错误包装
 * 5. 工具抛错 → 错误包装
 * 6. renderForNative / renderForText 的输出形状
 *
 * 不依赖真实模型与 API Key，纯进程内验证。
 */
import { askUserTool } from '../lib/tools/builtin/ask_user.ts';
import { invokeTool } from '../lib/tools/invoke.ts';
import { __clearRegistry, registerTool } from '../lib/tools/registry.ts';
import { renderForNative, renderForText } from '../lib/tools/render.ts';
import type { ToolDefinition } from '../lib/tools/types.ts';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(
    ok,
    ok ? label : `${label}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`
  );
}

async function testAskUser(): Promise<void> {
  console.log('\n[1] ask_user 正常调用');
  const result = await invokeTool({
    name: 'ask_user',
    args: { question: '你卡在哪一步？' },
  });
  assert(result.kind === 'awaiting_user', '返回 awaiting_user');
  if (result.kind === 'awaiting_user') {
    assertEqual(result.question, '你卡在哪一步？', 'question 透传正确');
  }
}

async function testAskUserEmpty(): Promise<void> {
  console.log('\n[2] ask_user 空 question');
  const result = await invokeTool({ name: 'ask_user', args: { question: '' } });
  assert(result.kind === 'result' && !result.ok, '返回 result/ok=false');
  if (result.kind === 'result' && !result.ok) {
    assert(result.error.includes('参数校验失败'), '错误信息包含参数校验');
  }
}

async function testUnknownTool(): Promise<void> {
  console.log('\n[3] 未知工具');
  const result = await invokeTool({ name: 'not_exists', args: {} });
  assert(result.kind === 'result' && !result.ok, '返回 result/ok=false');
  if (result.kind === 'result' && !result.ok) {
    assert(result.error.includes('未知工具'), '错误信息包含未知工具');
  }
}

async function testTimeout(): Promise<void> {
  console.log('\n[4] 工具超时');
  const slowTool: ToolDefinition = {
    name: 'slow_tool',
    description: '测试超时',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await new Promise((r) => setTimeout(r, 500));
      return { kind: 'result', data: 'should not reach' };
    },
  };
  registerTool(slowTool);
  const result = await invokeTool({
    name: 'slow_tool',
    args: {},
    ctx: { timeoutMs: 50 },
  });
  assert(result.kind === 'result' && !result.ok, '返回 result/ok=false');
  if (result.kind === 'result' && !result.ok) {
    assert(result.error.includes('超时'), '错误信息包含超时');
  }
}

async function testThrow(): Promise<void> {
  console.log('\n[5] 工具抛错');
  const errTool: ToolDefinition = {
    name: 'err_tool',
    description: '测试抛错',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      throw new Error('故意抛错');
    },
  };
  registerTool(errTool);
  const result = await invokeTool({ name: 'err_tool', args: {} });
  assert(result.kind === 'result' && !result.ok, '返回 result/ok=false');
  if (result.kind === 'result' && !result.ok) {
    assert(result.error === '故意抛错', '错误信息透传');
  }
}

function testRender(): void {
  console.log('\n[6] renderForNative / renderForText');
  const native = renderForNative([askUserTool]);
  assert(native.length === 1, 'native 数组长度 1');
  assertEqual(native[0].type, 'function', 'type=function');
  assertEqual(native[0].function.name, 'ask_user', 'name 正确');

  const text = renderForText([askUserTool]);
  assert(text.includes('```tool'), 'text 包含围栏标记');
  assert(text.includes('ask_user'), 'text 包含工具名');
  assert(text.includes('一次只能调用一个工具'), 'text 包含调用规则');
}

async function main(): Promise<void> {
  __clearRegistry();
  registerTool(askUserTool);

  await testAskUser();
  await testAskUserEmpty();
  await testUnknownTool();
  await testTimeout();
  await testThrow();
  testRender();

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('smoke 崩溃：', err);
  process.exit(1);
});
