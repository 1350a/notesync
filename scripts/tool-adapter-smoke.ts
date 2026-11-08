/**
 * 工具适配器冒烟测试
 * 运行：node scripts/tool-adapter-smoke.ts
 *
 * 覆盖：
 * 1. Native 增量流解析拼装。
 * 2. Native 历史回填与 ask_user 清洗。
 * 3. Text 流式正常输出透传。
 * 4. Text 流式围栏拦截与解析。
 * 5. Text 解析失败不透传（兜底职责在 loop，见 tool-loop-smoke.ts）。
 */
import type { ProviderMessage, StreamDelta } from '../lib/provider/types.ts';
import { NativeAdapter } from '../lib/tools/adapters/native.ts';
import { TextAdapter } from '../lib/tools/adapters/text.ts';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

/** 辅助：模拟异步生成器 */
async function* mockStream(deltas: StreamDelta[]): AsyncGenerator<StreamDelta> {
  for (const d of deltas) {
    yield d;
  }
}

async function testNativeParse() {
  console.log('\n[1] Native 增量流解析');
  const adapter = new NativeAdapter();
  const deltas: StreamDelta[] = [
    { content: '让我查一下。' },
    { toolCall: { index: 0, id: 'call_1', name: 'ask_user', argumentsDelta: '{"quest' } },
    { toolCall: { index: 0, argumentsDelta: 'ion": "你好吗"}' } },
  ];
  let contentOut = '';
  const res = await adapter.processStream(
    mockStream(deltas),
    (d) => (contentOut += d),
    () => {}
  );
  assert(contentOut === '让我查一下。', 'content 正常透传');
  assert(res.calls.length === 1, '提取出 1 个调用');
  assert(res.calls[0].name === 'ask_user', 'name 正确');
  assert(res.calls[0].arguments.question === '你好吗', 'arguments 拼装正确');
}

async function testNativeHistory() {
  console.log('\n[2] Native 历史回填与清洗');
  const adapter = new NativeAdapter();

  // 1. 模拟正常的保存历史（只存了 assistant 消息）
  const msgsNormal: ProviderMessage[] = [
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'ask_user', arguments: '{"question":"Q1"}' },
        },
      ],
    },
  ];
  const cleanedNormal = adapter.preprocessMessages(msgsNormal);
  assert(cleanedNormal.length === 1, '正常历史清洗后长度 1');
  assert(
    cleanedNormal[0].role === 'assistant' && cleanedNormal[0].content === '（询问用户）Q1',
    '正常历史转为纯文本'
  );
  assert(!cleanedNormal[0].tool_calls, 'tool_calls 被剥离');

  // 2. 模拟防御性清洗（如果历史里不小心混入了 tool 消息）
  const msgsWithTool: ProviderMessage[] = [
    ...msgsNormal,
    { role: 'tool', tool_call_id: 'call_1', name: 'ask_user', content: '{"awaiting_user":"Q1"}' },
  ];
  const cleanedWithTool = adapter.preprocessMessages(msgsWithTool);
  assert(cleanedWithTool.length === 1, '带 tool 历史清洗后长度 1（成功过滤）');
  assert(
    cleanedWithTool[0].role === 'assistant' && cleanedWithTool[0].content === '（询问用户）Q1',
    '带 tool 历史转为纯文本'
  );
}

async function testTextStreamNormal() {
  console.log('\n[3] Text 流式正常输出');
  const adapter = new TextAdapter();
  const deltas: StreamDelta[] = [{ content: '这是一' }, { content: '个回答。' }];
  let contentOut = '';
  const res = await adapter.processStream(
    mockStream(deltas),
    (d) => (contentOut += d),
    () => {}
  );
  assert(contentOut === '这是一个回答。', '内容完整透传');
  assert(res.calls.length === 0, '无工具调用');
}

async function testTextStreamTool() {
  console.log('\n[4] Text 流式围栏拦截');
  const adapter = new TextAdapter();
  const deltas: StreamDelta[] = [
    { content: '```tool\n' },
    { content: '{"tool": "ask_user", "arguments": {"question": "为什么？"}}\n' },
    { content: '```' },
  ];
  let contentOut = '';
  const res = await adapter.processStream(
    mockStream(deltas),
    (d) => (contentOut += d),
    () => {}
  );
  assert(contentOut === '', '围栏内容不被透传');
  assert(res.calls.length === 1, '提取出 1 个调用');
  assert(res.calls[0].name === 'ask_user', 'name 正确');
  assert(res.calls[0].arguments.question === '为什么？', '参数正确');
}

async function testTextStreamFallback() {
  console.log('\n[5] Text 解析失败不透传（兜底职责已移交 loop，见 tool-loop-smoke）');
  const adapter = new TextAdapter();
  // 以 { 开头，但不是合法 JSON，或者是普通文本里的代码块
  const deltas: StreamDelta[] = [{ content: '{ 这是一个' }, { content: '普通的开头 }' }];
  let contentOut = '';
  const res = await adapter.processStream(
    mockStream(deltas),
    (d) => (contentOut += d),
    () => {}
  );
  assert(contentOut === '', '解析失败时不回吐正文（由 loop 重试/兜底）');
  assert(res.parseError !== undefined, '返回 parseError 供 loop 裁决');
  assert(res.calls.length === 0, '无工具调用');
}

async function main() {
  await testNativeParse();
  await testNativeHistory();
  await testTextStreamNormal();
  await testTextStreamTool();
  await testTextStreamFallback();

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
