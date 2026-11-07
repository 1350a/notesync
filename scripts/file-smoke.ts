/**
 * 诊断文件接入冒烟测试（Node 原生 strip-types，零依赖直跑）
 *
 * 运行：`npm run smoke:files`
 * 或：  `node scripts/file-smoke.ts`
 *
 * 覆盖：
 * 1. detect 判定：图片 / PDF / 文本 / Word 拒收 / 未知类型
 * 2. assemble 四类标签的分组顺序与锚点
 * 3. 文本预算按文件数均分 + 超长截断
 * 4. 单文件最小预算抬升
 * 5. 图片数量上限与降级为文字占位
 * 6. text-only 模式下图片全部降级
 * 7. 空输入 / 全部无效内容时的返回形态
 *
 * 不依赖真实模型与 API Key，纯进程内验证。
 */
import { assembleDiagnoseMessage } from '../lib/diagnose/assemble.ts';
import { detectFile } from '../lib/diagnose/detect.ts';
import type { DiagnoseAttachment } from '../lib/diagnose/types.ts';
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

/** 取 parts 数组；组装结果必须是 parts 形式（本项目不产 plain string content） */
function partsOf(items: DiagnoseAttachment[], options = {}): (ProviderTextPart | ProviderImagePart)[] {
  const result = assembleDiagnoseMessage(items, options);
  const content = result.message?.content;
  if (!Array.isArray(content)) {
    assert(false, '组装结果 content 应为 parts 数组');
    return [];
  }
  return content;
}

function textOf(part: ProviderTextPart | ProviderImagePart): string {
  return part.type === 'text' ? part.text : '';
}

const IMG: DiagnoseAttachment = { name: 'a.png', category: 'origin', dataUrl: 'data:image/png;base64,AAAA' };

console.log('\n[1] detect 判定');
assertEqual(detectFile('a.JPG', '').kind, 'image', '大写扩展名仍判为图片');
assertEqual(detectFile('a', 'image/webp').kind, 'image', '无扩展名时用 MIME 兜底');
assertEqual(detectFile('q.pdf', 'application/pdf').supported, true, 'PDF 可接收');
assertEqual(detectFile('n.md', '').kind, 'text', 'md 归为纯文本');
const docResult = detectFile('w.docx', '');
assertEqual(docResult.supported, false, 'docx 拒收');
assert(docResult.reason?.includes('w.docx') === true, '拒收原因包含文件名');
assertEqual(detectFile('x.exe', '').kind, 'unsupported', '未知扩展名判为 unsupported');

console.log('\n[2] 四类标签分组顺序与锚点');
{
  const items: DiagnoseAttachment[] = [
    { name: 'ana.txt', category: 'analysis', text: '解析内容' },
    { name: 'org.png', category: 'origin', dataUrl: IMG.dataUrl },
    { name: 'cor.txt', category: 'correct', text: '正确答案内容' },
    { name: 'wro.txt', category: 'wrong', text: '错误答案内容' },
  ];
  const parts = partsOf(items);
  const texts = parts.filter((p) => p.type === 'text').map(textOf);
  const anchors = texts.filter((t) => t.includes('【'));
  assertEqual(
    anchors.map((t) => t.slice(t.indexOf('【'), t.indexOf('】') + 1)),
    ['【错题原题】', '【我的错误答案】', '【正确答案】', '【标准解析】'],
    '锚点按 origin→wrong→correct→analysis 排列'
  );
  assert(parts.some((p) => p.type === 'image_url'), '图片以 image_url part 发出');
  assert(anchors[0].includes('1 个文件'), '锚点标注该组文件数');
}

console.log('\n[3] 文本预算均分与截断');
{
  const long = 'x'.repeat(9000);
  const items: DiagnoseAttachment[] = [
    { name: 'l1.txt', category: 'origin', text: long },
    { name: 'l2.txt', category: 'wrong', text: long },
  ];
  const result = assembleDiagnoseMessage(items, { totalChars: 8000 });
  const content = result.message?.content;
  const parts = Array.isArray(content) ? content : [];
  // 文本 part 形如 "[文件 xxx]\n正文"，正文取第二行
  const bodies = parts.map(textOf).filter((t) => t.startsWith('[文件 l'));
  assertEqual(bodies.map((b) => b.split('\n')[1].length), [4000, 4000], '两份文本各占 4000 字符');
  assert(bodies.every((b) => b.includes('已截断')), '截断标注写进正文 part');
  assert(result.warnings.length === 2, '两份都记录了截断告警');
  assertEqual(result.stats.chars, 8000, '计入字符数为 8000');
}

console.log('\n[4] 单文件预算下限');
{
  const items: DiagnoseAttachment[] = Array.from({ length: 10 }, (_, i) => ({
    name: `t${i}.txt`,
    category: 'origin' as const,
    text: 'y'.repeat(3000),
  }));
  const result = assembleDiagnoseMessage(items, { totalChars: 8000, minCharsPerFile: 200 });
  const content = result.message?.content;
  const bodies = (Array.isArray(content) ? content : [])
    .map(textOf)
    .filter((t) => t.startsWith('[文件 t'))
    .map((t) => t.split('\n')[1].length);
  assertEqual(new Set(bodies).size, 1, '10 份文件单份长度一致');
  assertEqual(bodies[0], 800, '均分不足 200 时抬到下限（此处 800）');
}

console.log('\n[5] 图片数量上限');
{
  const items: DiagnoseAttachment[] = Array.from({ length: 6 }, (_, i) => ({
    name: `p${i}.png`,
    category: 'origin' as const,
    dataUrl: IMG.dataUrl,
  }));
  const result = assembleDiagnoseMessage(items, { maxImages: 4 });
  const content = result.message?.content;
  const parts = Array.isArray(content) ? content : [];
  assertEqual(parts.filter((p) => p.type === 'image_url').length, 4, '只发 4 张图');
  assertEqual(result.stats.images, 4, '统计图片数为 4');
  assert(
    result.warnings.some((w) => w.includes('超出图片数量上限')),
    '超出部分记录降级告警'
  );
  assert(
    parts.some((p) => p.type === 'text' && p.text.includes('未发送图像本体')),
    '超出部分留下文字占位'
  );
}

console.log('\n[6] text-only 模式');
{
  const result = assembleDiagnoseMessage([IMG], { imageMode: 'text-only' });
  const content = result.message?.content;
  const parts = Array.isArray(content) ? content : [];
  assertEqual(parts.filter((p) => p.type === 'image_url').length, 0, '不发送 image_url');
  assertEqual(result.stats.images, 0, '统计图片数为 0');
  assert(
    result.warnings.some((w) => w.includes('当前模型不支持图片输入')),
    '记录不支持图片的告警'
  );
}

console.log('\n[7] 空输入与无效内容');
{
  const empty = assembleDiagnoseMessage([]);
  assertEqual(empty.message, null, '空数组返回 null');
  assertEqual(empty.warnings.length, 0, '空数组无告警');

  const invalid = assembleDiagnoseMessage([{ name: 'bad.txt', category: 'origin', text: '   ' }]);
  const invalidContent = invalid.message?.content;
  const invalidParts = Array.isArray(invalidContent) ? invalidContent : [];
  assertEqual(invalidParts.length, 1, '仅保留锚点，不产出空正文 part');
  assertEqual(invalid.stats.texts, 0, '统计文本数为 0');
  assert(
    invalid.warnings.some((w) => w.includes('未提取到可用内容')),
    '记录未提取到内容的告警'
  );
}

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
