/**
 * 工具循环冒烟测试（Node 原生 strip-types，零依赖直跑）
 *
 * 运行：`npm run smoke:loop`
 * 或：  `node scripts/tool-loop-smoke.ts`
 *
 * 覆盖（doc/tool-protocol.md §5.3 / §8.3）：
 * 1. text 解析失败 → 重试 1 次后成功（重试不消耗轮数，不回吐残缺 buffer）
 * 2. text 重试仍失败 → 原始输出视为普通回答（finishReason=stop，无 error）
 * 3. maxRounds 耗尽 → 收敛请求不带 tools，finishReason=max_rounds
 * 4. 收敛请求失败 → provider_error 且不开 done（§8.2 语义）
 * 5. 最后一轮自然 stop → 不误标 max_rounds（exhausted 标志回归用例）
 * 6. 模型请求抛错 → error 事件带 code=provider_error，不开 done
 *
 * 不依赖真实模型与 API Key：用脚本化的假 Provider 逐轮回放 StreamDelta。
 */
import type { CompleteOptions, LLMProvider, StreamDelta } from '../lib/provider/types.ts';
import { NativeAdapter } from '../lib/tools/adapters/native.ts';
import { TextAdapter } from '../lib/tools/adapters/text.ts';
import { askUserTool } from '../lib/tools/builtin/ask_user.ts';
import { runToolLoop } from '../lib/tools/loop.ts';
import { __clearRegistry, registerTool } from '../lib/tools/registry.ts';
import type { ToolLoopEvent } from '../lib/tools/types.ts';

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

/** 脚本化假 Provider：第 n 次 streamDetailed 调用回放 scripted[n]（Error 则抛出），并记录请求 */
function fakeProvider(scripted: (StreamDelta[] | Error)[]): {
  provider: LLMProvider;
  requests: CompleteOptions[];
} {
  const requests: CompleteOptions[] = [];
  const provider: LLMProvider = {
    name: 'custom',
    displayName: 'FakeProvider',
    complete: async () => '',
    listModels: async () => [],
    probe: async () => ({ status: 'unconfigured', models: [], source: 'none' }),
    ownsModel: () => true,
    isAvailable: () => true,
    async *streamDetailed(options: CompleteOptions): AsyncGenerator<StreamDelta> {
      const script = scripted[requests.length];
      requests.push(options);
      if (script instanceof Error) throw script;
      for (const delta of script) yield delta;
    },
  };
  return { provider, requests };
}

async function collect(gen: AsyncGenerator<ToolLoopEvent>): Promise<ToolLoopEvent[]> {
  const out: ToolLoopEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

function filterType(events: ToolLoopEvent[], type: ToolLoopEvent['type']): ToolLoopEvent[] {
  return events.filter((e) => e.type === type);
}

/** native 模式一轮 echo 工具调用的流式分片 */
const echoCall: StreamDelta[] = [
  { toolCall: { index: 0, id: 'call_e1', name: 'echo', argumentsDelta: '{"text":"hi"}' } },
];

async function testTextRetrySuccess(): Promise<void> {
  console.log('\n[1] text 解析失败 → 重试成功');
  const { provider, requests } = fakeProvider([
    // 第 1 轮：残缺围栏（buffer 模式 + JSON 不匹配）→ parseError
    [{ content: '```tool\n{"tool": "ask_user", "argumen' }],
    // 第 2 轮（重试）：完整 ask_user 调用（多问题+预设选项）
    [
      {
        content:
          '```tool\n{"tool": "ask_user", "arguments": {"questions": [{"question": "你卡在哪一步？", "options": ["第一步", "第二步"]}]}}',
      },
    ],
  ]);
  const events = await collect(
    runToolLoop({
      model: 'fake',
      provider,
      messages: [{ role: 'user', content: '我有一道题不会' }],
      adapter: new TextAdapter(),
      tools: [askUserTool],
      maxRounds: 3,
    })
  );

  assert(filterType(events, 'error').length === 0, '无 error 事件');
  assert(filterType(events, 'content').length === 0, '残缺 buffer 未回吐为正文');
  const awaiting = filterType(events, 'awaiting_user');
  assert(awaiting.length === 1, '产出 awaiting_user 中断');
  assert(
    awaiting[0]?.type === 'awaiting_user' && awaiting[0].questions[0]?.question === '你卡在哪一步？',
    'questions 透传正确'
  );
  assert(
    awaiting[0]?.type === 'awaiting_user' && awaiting[0].questions[0]?.options?.[0] === '第一步',
    '预设选项透传正确'
  );
  const done = filterType(events, 'done')[0];
  assert(done?.type === 'done' && done.finishReason === 'awaiting_user', 'finishReason=awaiting_user');
  assert(done?.type === 'done' && done.usedRounds === 1, '重试不消耗轮数（usedRounds=1）');
  assert(requests.length === 2, '模型请求恰好发了 2 次（原始 + 重试）');
}

async function testTextRetryExhausted(): Promise<void> {
  console.log('\n[2] text 重试仍失败 → 视为普通回答');
  const bad = '```tool\n{"tool": "ask_user", "argumen';
  const { provider, requests } = fakeProvider([
    [{ content: bad }],
    [{ content: bad }],
  ]);
  const events = await collect(
    runToolLoop({
      model: 'fake',
      provider,
      messages: [{ role: 'user', content: '我有一道题不会' }],
      adapter: new TextAdapter(),
      tools: [askUserTool],
      maxRounds: 3,
    })
  );

  assert(filterType(events, 'error').length === 0, '无 error 事件（不再中断本轮）');
  const contents = filterType(events, 'content');
  assert(contents.length === 1, '原始输出作为正文产出一次（无重复）');
  assert(
    contents[0]?.type === 'content' && contents[0].delta === bad,
    '正文内容等于原始输出'
  );
  const done = filterType(events, 'done')[0];
  assert(done?.type === 'done' && done.finishReason === 'stop', 'finishReason=stop');
  assert(done?.type === 'done' && done.usedRounds === 1, '重试不消耗轮数（usedRounds=1）');
  assert(requests.length === 2, '模型请求恰好发了 2 次');
}

async function testMaxRoundsConvergence(): Promise<void> {
  console.log('\n[3] maxRounds 耗尽 → 收敛请求');
  const { provider, requests } = fakeProvider([
    echoCall,
    echoCall,
    // 收敛请求：纯文本回答
    [{ content: '这是收敛后的最终回答' }],
  ]);
  const events = await collect(
    runToolLoop({
      model: 'fake',
      provider,
      messages: [{ role: 'user', content: '帮我查点什么' }],
      adapter: new NativeAdapter(),
      tools: [
        {
          name: 'echo',
          description: '测试用：原样返回 text',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          handler: async (args) => ({ kind: 'result', data: { echoed: args.text }, summary: 'echo ok' }),
        },
      ],
      maxRounds: 2,
    })
  );

  assert(filterType(events, 'tool_call').length === 2, '两轮各产出一次 tool_call');
  assert(filterType(events, 'tool_result').length === 2, '两轮各产出一次 tool_result');
  assert(requests.length === 3, '共 3 次模型请求（2 轮工具 + 1 次收敛）');
  const convergeReq = requests[2];
  assert(convergeReq?.tools === undefined, '收敛请求不带 tools');
  assert(convergeReq?.toolChoice === undefined, '收敛请求不带 toolChoice');
  const lastMsg = convergeReq?.messages.at(-1);
  assert(lastMsg?.role === 'system', '收敛请求末尾追加 system 提示');
  assert(
    lastMsg?.role === 'system' && typeof lastMsg.content === 'string' && lastMsg.content.includes('直接回答'),
    'system 提示要求直接回答'
  );
  const contents = filterType(events, 'content');
  assert(
    contents.length === 1 && contents[0]?.type === 'content' && contents[0].delta === '这是收敛后的最终回答',
    '收敛回答流式产出'
  );
  const done = filterType(events, 'done')[0];
  assert(done?.type === 'done' && done.finishReason === 'max_rounds', 'finishReason=max_rounds');
  assert(done?.type === 'done' && done.usedRounds === 2, 'usedRounds=2（收敛不计轮数）');
}

async function testConvergenceFailure(): Promise<void> {
  console.log('\n[4] 收敛请求失败 → provider_error 且无 done');
  const { provider, requests } = fakeProvider([echoCall, echoCall, new Error('收敛请求网络失败')]);
  const events = await collect(
    runToolLoop({
      model: 'fake',
      provider,
      messages: [{ role: 'user', content: '帮我查点什么' }],
      adapter: new NativeAdapter(),
      tools: [
        {
          name: 'echo',
          description: '测试用：原样返回 text',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          handler: async (args) => ({ kind: 'result', data: { echoed: args.text }, summary: 'echo ok' }),
        },
      ],
      maxRounds: 2,
    })
  );

  const errors = filterType(events, 'error');
  assert(errors.length === 1, '只发一条 error');
  assert(
    errors[0]?.type === 'error' && errors[0].code === 'provider_error',
    'error 带 code=provider_error'
  );
  assert(filterType(events, 'done').length === 0, '不开 done（§8.2 语义）');
  assert(requests.length === 3, '收敛请求确实发出过');
}

async function testNaturalStopNotMaxRounds(): Promise<void> {
  console.log('\n[5] 最后一轮自然 stop 不误标 max_rounds');
  const { provider, requests } = fakeProvider([[{ content: '直接回答，不调用工具' }]]);
  const events = await collect(
    runToolLoop({
      model: 'fake',
      provider,
      messages: [{ role: 'user', content: '你好' }],
      adapter: new NativeAdapter(),
      tools: [],
      maxRounds: 1,
    })
  );

  const done = filterType(events, 'done')[0];
  assert(done?.type === 'done' && done.finishReason === 'stop', 'finishReason=stop（回归用例）');
  assert(done?.type === 'done' && done.usedRounds === 1, 'usedRounds=1');
  assert(requests.length === 1, '无收敛请求');
}

async function testProviderError(): Promise<void> {
  console.log('\n[6] 模型请求抛错 → provider_error');
  const { provider } = fakeProvider([new Error('上游 401 鉴权失败')]);
  const events = await collect(
    runToolLoop({
      model: 'fake',
      provider,
      messages: [{ role: 'user', content: '你好' }],
      adapter: new NativeAdapter(),
      tools: [],
      maxRounds: 3,
    })
  );

  const errors = filterType(events, 'error');
  assert(errors.length === 1, '只发一条 error');
  assert(
    errors[0]?.type === 'error' && errors[0].code === 'provider_error',
    'error 带 code=provider_error'
  );
  assert(
    errors[0]?.type === 'error' && errors[0].message.includes('401'),
    '错误信息包含上游原因'
  );
  assert(filterType(events, 'done').length === 0, '不开 done');
}

async function main(): Promise<void> {
  // 隔离注册表，显式注册本脚本用到的工具
  __clearRegistry();
  registerTool(askUserTool);

  await testTextRetrySuccess();
  await testTextRetryExhausted();
  await testMaxRoundsConvergence();
  await testConvergenceFailure();
  await testNaturalStopNotMaxRounds();
  await testProviderError();

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
