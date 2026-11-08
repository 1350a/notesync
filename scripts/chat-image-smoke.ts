/**
 * 聊天图片组装冒烟测试（Node 原生 strip-types，零依赖直跑）
 *
 * 运行：`npm run smoke:chat`
 * 或：  `node scripts/chat-image-smoke.ts`
 *
 * 覆盖：
 * 1. 图片 dataUrl -> image_url 多模态片段
 * 2. 纯文字消息保持字符串形态
 * 3. 非 data:image/ 前缀、超长 dataUrl 逐张丢弃
 * 4. 只有图片没有文字时，content 数组不含空 text 片段
 * 5. 带图消息超过 MAX_IMAGE_MESSAGES 时，较早的退化��纯文字
 * 6. messages 为空时回落 content 字段
 *
 * 不依赖真实模型与 API Key，纯进程内验证。
 */
import {
  buildProviderMessages,
  buildUserContent,
  MAX_DATA_URL,
  MAX_FILE_MESSAGES,
  MAX_IMAGE_MESSAGES,
  MAX_TEXT_FILE_CHARS,
} from '../lib/chat/messages.ts';
import type { ProviderImagePart, ProviderTextPart } from '../lib/provider/types.ts';

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

const IMG_A = 'data:image/png;base64,AAAA';
const IMG_B = 'data:image/jpeg;base64,BBBB';

console.log('\n[1] buildUserContent：图片 + 文字');
{
  const content = buildUserContent('这是什么', [IMG_A, IMG_B]);
  assert(Array.isArray(content), '返回数组形态');
  const parts = content as (ProviderTextPart | ProviderImagePart)[];
  assertEqual(parts.length, 3, 'part 数 = 1 文本 + 2 图片');
  assertEqual(parts[0], { type: 'text', text: '这是什么' }, '首片为文本');
  assertEqual(
    parts[1],
    { type: 'image_url', image_url: { url: IMG_A } },
    '第二片为 image_url（原样透传 dataUrl）'
  );
}

console.log('\n[2] buildUserContent：无图片时保持字符串');
{
  const content = buildUserContent('纯文字', []);
  assertEqual(content, '纯文字', '无图片返回原始字符串');
  assertEqual(buildUserContent('纯文字', undefined), '纯文字', 'images=undefined 也不炸');
}

console.log('\n[3] buildUserContent：脏数据逐张丢弃');
{
  const parts = buildUserContent('看图', [
    'https://example.com/a.png',
    'data:text/plain;base64,AAAA',
    `data:image/png;base64,${'A'.repeat(MAX_DATA_URL)}`,
    IMG_A,
  ]) as (ProviderTextPart | ProviderImagePart)[];
  assert(Array.isArray(parts), '仍有合法图片时保持数组');
  assertEqual(parts.filter((p) => p.type === 'image_url').length, 1, '只保留 1 张合法图片');
}

console.log('\n[4] buildUserContent：只有图片没有文字');
{
  const parts = buildUserContent('   ', [IMG_A]) as (ProviderTextPart | ProviderImagePart)[];
  assertEqual(parts.length, 1, '不生成空白 text 片段');
  assertEqual(parts[0].type, 'image_url', '唯一片段为图片');
}

console.log('\n[5] buildProviderMessages：消息序列组装');
{
  const { messages, droppedImageMessages } = buildProviderMessages({
    messages: [
      { role: 'user', content: '第一句', images: [IMG_A] },
      { role: 'assistant', content: '收到' },
      { role: 'user', content: '第二句', images: [IMG_B] },
    ],
  });
  assertEqual(messages.length, 3, '三条消息全部保留');
  assertEqual(droppedImageMessages, 0, '未丢弃任何带图消息');
  assert(Array.isArray(messages[2].content), '最后一条带图消息为多模态数组');
  assertEqual(messages[1].content, '收到', 'assistant 消息保持字符串');
}

console.log(`\n[6] buildProviderMessages：超过 ${MAX_IMAGE_MESSAGES} 条带图消息`);
{
  const history = Array.from({ length: MAX_IMAGE_MESSAGES + 1 }, (_, i) => ({
    role: 'user' as const,
    content: `第 ${i + 1} 句`,
    images: [IMG_A],
  }));
  const { messages, droppedImageMessages } = buildProviderMessages({ messages: history });
  assertEqual(droppedImageMessages, 1, '最早一条带图消息的图片被丢弃');
  assertEqual(messages[0].content, '第 1 句', '最早一条退化为纯文字');
  assert(Array.isArray(messages[1].content), '第二条仍带图（保留最近 N 条）');
  assert(
    messages.filter((m) => Array.isArray(m.content)).length === MAX_IMAGE_MESSAGES,
    `保留图片的消息条数 = ${MAX_IMAGE_MESSAGES}`
  );
}

console.log('\n[7] buildProviderMessages：无 messages 时回落 content');
{
  const { messages } = buildProviderMessages({ content: '兜底文本' });
  assertEqual(messages, [{ role: 'user', content: '兜底文本' }], '单条 user 消息');
  const empty = buildProviderMessages({});
  assertEqual(empty.messages, [{ role: 'user', content: '' }], '全空时给出空内容而非崩溃');
}

console.log('\n[8] 文本文件：拼进正文 / 校验丢弃 / 多轮上限');
{
  const merged = buildProviderMessages({
    messages: [
      {
        role: 'user',
        content: '看下这个文件',
        files: [{ name: 'note.md', text: '# 标题\n正文' }],
      },
    ],
  });
  assertEqual(
    merged.messages[0].content,
    '看下这个文件\n\n[文件 note.md]\n# 标题\n正文',
    '正文与文件内容按 [文件 名字] 锚点拼接'
  );
  assertEqual(merged.droppedFileMessages, 0, '单条消息不触发文件丢弃');

  const dirty = buildProviderMessages({
    messages: [
      {
        role: 'user',
        content: '',
        files: [
          { name: '', text: '缺文件名' },
          { name: 'empty.txt', text: '   ' },
          { name: 'huge.txt', text: 'x'.repeat(MAX_TEXT_FILE_CHARS + 1) },
          { name: 'ok.txt', text: 'ok' },
        ],
      },
    ],
  });
  assertEqual(dirty.messages[0].content, '[文件 ok.txt]\nok', '脏文件逐条丢弃，仅保留合法项');

  const many = buildProviderMessages({
    messages: Array.from({ length: MAX_FILE_MESSAGES + 1 }, (_, i) => ({
      role: 'user' as const,
      content: `第 ${i + 1} 句`,
      files: [{ name: `f${i + 1}.txt`, text: 'body' }],
    })),
  });
  assertEqual(many.droppedFileMessages, 1, '超出上限的较早文件消息被丢弃');
  assert(
    !(many.messages[0].content as string).includes('[文件 f1.txt]'),
    '最早一条不再携带文件正文'
  );
  assert(
    (many.messages[0].content as string).includes('文件内容已省略'),
    '最早一条给出省略提示'
  );

  const imageAndFile = buildProviderMessages({
    messages: [
      { role: 'user', content: '图文', images: [IMG_A], files: [{ name: 'a.txt', text: 'A' }] },
    ],
  });
  const parts = imageAndFile.messages[0].content;
  assert(Array.isArray(parts), '图片 + 文件混合时仍走高阶内容数组');
  assert(
    Array.isArray(parts) &&
      parts.some((p) => p.type === 'text' && p.text.includes('[文件 a.txt]')),
    '文件内容进入 text 片段，图片各自成 image_url 片段'
  );
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;
