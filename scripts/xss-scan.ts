/**
 * 通用 XSS 静态扫描（Node 原生 strip-types，零依赖直跑）
 *
 * 运行：`npm run scan:xss`
 * 自检：`npm run scan:xss -- --self-test`
 * JSON：`npm run scan:xss -- --json`
 * 指定目录：`npm run scan:xss -- --root app`
 *
 * 定位：正则级启发式扫描，不是 AST 污点分析。命中表示“值得人工复核的点”，
 * 不代表一定可利用；没命中也不代表绝对安全。规则表见 LINE_RULES 与
 * scanMarkdownPipeline。
 *
 * 豁免：在目标行上一行写 `// xss-scan-disable-next-line`，
 * 或在同一行行尾写 `// xss-scan-disable-line`。
 *
 * 退出码：命中 high 时为 1，否则为 0。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Severity = 'high' | 'medium' | 'low';

interface Finding {
  file: string;
  line: number;
  column: number;
  severity: Severity;
  ruleId: string;
  excerpt: string;
}

interface LineRule {
  id: string;
  severity: Severity;
  pattern: RegExp;
}

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** 构建产物、第三方代码、二进制资源目录不参与扫描 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.turbo',
  '.vercel',
  'dist',
  'out',
  'build',
  'coverage',
  'public',
  'tessdata',
]);

const DISABLE_NEXT = 'xss-scan-disable-next-line';
const DISABLE_LINE = 'xss-scan-disable-line';

/** 扫描器自身是规则定义源，内含大量规则字符串，纳入扫描只会自我误报 */
const SELF_PATH = fileURLToPath(import.meta.url).toLowerCase();

const LINE_RULES: LineRule[] = [
  { id: 'sink.raw-html', severity: 'high', pattern: /dangerouslySetInnerHTML/ },
  { id: 'sink.inner-html', severity: 'high', pattern: /\.(innerHTML|outerHTML)\s*=[^=]/ },
  { id: 'sink.insert-html', severity: 'high', pattern: /\.insertAdjacentHTML\s*\(/ },
  { id: 'sink.new-function', severity: 'high', pattern: /\bnew\s+Function\s*\(/ },
  { id: 'sink.eval', severity: 'high', pattern: /(^|[^.\w$])eval\s*\(/ },
  { id: 'sink.doc-write', severity: 'high', pattern: /document\.(write|writeln)\s*\(/ },
  { id: 'url.dynamic-href', severity: 'low', pattern: /href\s*=\s*\{\s*(?!['"`])/ },
  { id: 'md.skip-html-off', severity: 'low', pattern: /skipHtml\s*=\s*\{?\s*false/ },
];

function makeFinding(
  file: string,
  line: number,
  column: number,
  severity: Severity,
  ruleId: string,
  excerpt: string
): Finding {
  return { file, line, column, severity, ruleId, excerpt };
}

function lineOfPattern(lines: string[], pattern: string | RegExp): number {
  for (let i = 0; i < lines.length; i += 1) {
    const hit = typeof pattern === 'string' ? lines[i].includes(pattern) : pattern.test(lines[i]);
    if (hit) return i + 1;
  }
  // 落空时兜底到首行，避免返回 0 造成 `文件:0` 这种无效位置
  return 1;
}

/**
 * 取出 rehypePlugins 数组里各插件的下标。
 * JSX 属性常写在一行内，这里只取 `rehypePlugins` 之后的小窗口按逗号切分，
 * 够用且不会把整个文件都当成插件列表。
 */
function pluginIndex(text: string, pattern: RegExp): number {
  const anchor = text.indexOf('rehypePlugins');
  if (anchor < 0) return -1;
  const window = text.slice(anchor, anchor + 400);
  const tokens = window.split(',');
  for (let i = 0; i < tokens.length; i += 1) {
    if (pattern.test(tokens[i])) return i;
  }
  return -1;
}

function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    if (prev.includes(DISABLE_NEXT) || line.includes(DISABLE_LINE)) continue;

    for (const rule of LINE_RULES) {
      const match = rule.pattern.exec(line);
      if (!match) continue;
      findings.push(
        makeFinding(file, i + 1, match.index + 1, rule.severity, rule.id, line.trim().slice(0, 120))
      );
    }
  }

  // target="_blank" 缺 rel：JSX 里 rel 常写在下一行，所以看三行窗口
  for (let i = 0; i < lines.length; i += 1) {
    if (!/target\s*=\s*["']_blank["']/.test(lines[i])) continue;
    const prev = i > 0 ? lines[i - 1] : '';
    if (prev.includes(DISABLE_NEXT) || lines[i].includes(DISABLE_LINE)) continue;
    const window = [lines[i], lines[i + 1] ?? '', lines[i + 2] ?? ''].join(' ');
    if (/noopener|noreferrer/.test(window)) continue;
    findings.push(
      makeFinding(file, i + 1, 1, 'medium', 'link.target-blank', lines[i].trim().slice(0, 120))
    );
  }

  findings.push(...scanMarkdownPipeline(file, text, lines));
  return findings;
}

/** Markdown 渲染链：rehypeRaw 有无净化、净化与 raw 的先后顺序 */
function scanMarkdownPipeline(file: string, text: string, lines: string[]): Finding[] {
  if (!text.includes('rehypeRaw')) return [];

  const rawLine = lineOfPattern(lines, 'rehypeRaw');
  const sanitizePlugin = pluginIndex(text, /sanitize/i);
  if (sanitizePlugin < 0) {
    return [
      makeFinding(
        file,
        rawLine,
        1,
        'high',
        'md.raw-without-sanitize',
        '启用 rehypeRaw 渲染原始 HTML，但整个文件没有净化插件'
      ),
    ];
  }

  const rawPlugin = pluginIndex(text, /rehypeRaw/);
  if (rawPlugin >= 0 && rawPlugin > sanitizePlugin) {
    return [
      makeFinding(
        file,
        rawLine,
        1,
        'high',
        'md.sanitize-order',
        'rehypeRaw 排在净化插件之后，原始 HTML 会绕过白名单'
      ),
    ];
  }

  return [];
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      collectFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (full.toLowerCase() === SELF_PATH) continue;
    if (!SCAN_EXTENSIONS.has(extname(entry.name))) continue;
    out.push(full);
  }
  return out;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    return a.ruleId < b.ruleId ? -1 : 1;
  });
}

function formatFinding(finding: Finding): string {
  const level = finding.severity.padEnd(6, ' ');
  return `${finding.file}:${finding.line}:${finding.column} | ${level} | ${finding.ruleId} | ${finding.excerpt}`;
}

// ---------------------------------------------------------------------------
// 自检：内置正反例，保证规则不会因为改正则而静默失效
// ---------------------------------------------------------------------------

interface SelfTestFixture {
  name: string;
  text: string;
  expected: string[];
}

const SELF_TEST_FIXTURES: SelfTestFixture[] = [
  {
    name: 'dangerouslySetInnerHTML',
    text: '<div dangerouslySetInnerHTML={{ __html: html }} />',
    expected: ['sink.raw-html'],
  },
  {
    name: 'innerHTML 赋值',
    text: 'node.innerHTML = modelOutput;',
    expected: ['sink.inner-html'],
  },
  {
    name: 'insertAdjacentHTML',
    text: "el.insertAdjacentHTML('beforeend', chunk);",
    expected: ['sink.insert-html'],
  },
  {
    name: 'eval 直调',
    text: "const value = eval('1 + 1');",
    expected: ['sink.eval'],
  },
  {
    name: '对象上的 .eval 不误报',
    text: "math.eval('2 + 2');",
    expected: [],
  },
  {
    name: 'new Function',
    text: "const fn = new Function('a', 'return a');",
    expected: ['sink.new-function'],
  },
  {
    name: 'document.write',
    text: "document.write('<b>x</b>');",
    expected: ['sink.doc-write'],
  },
  {
    name: 'rehypeRaw 无净化',
    text: 'rehypePlugins={[rehypeKatex, rehypeRaw]}',
    expected: ['md.raw-without-sanitize'],
  },
  {
    name: '净化排在 raw 之后',
    text: 'rehypePlugins={[rehypeSanitizeMarkdown, rehypeRaw]}',
    expected: ['md.sanitize-order'],
  },
  {
    name: '正确顺序不报',
    text: 'rehypePlugins={[rehypeRaw, rehypeSanitizeMarkdown, rehypeKatex]}',
    expected: [],
  },
  {
    name: 'disable-next-line 生效',
    text: '// xss-scan-disable-next-line\nconst html = el.innerHTML = payload;',
    expected: [],
  },
  {
    name: 'disable-line 生效',
    text: 'el.innerHTML = payload; // xss-scan-disable-line',
    expected: [],
  },
  {
    name: 'target=_blank 缺 rel',
    text: '<a href="https://example.com" target="_blank">外链</a>',
    expected: ['link.target-blank'],
  },
  {
    name: 'target=_blank 带 rel 不报',
    text: '<a href="https://example.com" target="_blank" rel="noopener noreferrer">外链</a>',
    expected: [],
  },
  {
    name: 'skipHtml={false}',
    text: '<ReactMarkdown skipHtml={false}>{content}</ReactMarkdown>',
    expected: ['md.skip-html-off'],
  },
  {
    name: '动态 href',
    text: '<a href={modelOutput}>点我</a>',
    expected: ['url.dynamic-href'],
  },
  {
    name: '静态 href 不报',
    text: '<a href="/docs">文档</a>',
    expected: [],
  },
];

function runSelfTest(): void {
  let passed = 0;
  let failed = 0;

  for (const fixture of SELF_TEST_FIXTURES) {
    const actual = scanText('<self-test>', fixture.text)
      .map((finding) => finding.ruleId)
      .sort();
    const expected = [...fixture.expected].sort();
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
      passed += 1;
      console.log(`  ✓ ${fixture.name}`);
    } else {
      failed += 1;
      console.error(
        `  ✗ ${fixture.name}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`
      );
    }
  }

  console.log(`\n自检结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  json: boolean;
  selfTest: boolean;
  help: boolean;
  root: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { json: false, selfTest: false, help: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--root') {
      const next = argv[i + 1];
      if (next) {
        options.root = next;
        i += 1;
      }
    } else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
  }
  return options;
}

function printUsage(): void {
  console.log(
    [
      '用法：node scripts/xss-scan.ts [--json] [--self-test] [--root <dir>]',
      '',
      '  --json       以 JSON 输出全部命中',
      '  --self-test  只跑内置正反例，校验规则本身',
      '  --root <dir> 指定扫描根目录，默认当前工作目录',
      '',
      '豁免：目标行上一行写 // xss-scan-disable-next-line，或行尾写 // xss-scan-disable-line',
    ].join('\n')
  );
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  const root = resolve(options.root);
  const files = collectFiles(root).sort();

  const scanned: { rel: string; text: string }[] = files.map((abs) => ({
    rel: relative(root, abs).split('\\').join('/'),
    text: readFileSync(abs, 'utf8'),
  }));

  const findings: Finding[] = [];
  for (const item of scanned) findings.push(...scanText(item.rel, item.text));

  // CSP 是兜底防线：整仓都没有该响应头时给一条 low 提示，不阻塞流程
  const hasCsp = scanned.some((item) => /content-security-policy/i.test(item.text));
  if (!hasCsp) {
    const anchor =
      scanned.find((item) => /(^|\/)next\.config\./.test(item.rel))?.rel ?? '(project root)';
    findings.push(
      makeFinding(anchor, 1, 1, 'low', 'csp.missing', '未找到 Content-Security-Policy 响应头配置')
    );
  }

  const sorted = sortFindings(findings);

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const finding of sorted) counts[finding.severity] += 1;

  if (options.json) {
    console.log(JSON.stringify({ root, scanned: scanned.length, counts, findings: sorted }, null, 2));
  } else {
    console.log(`扫描 ${scanned.length} 个文件（根目录 ${root}）\n`);
    if (sorted.length === 0) {
      console.log('未发现可疑点。');
    } else {
      for (const finding of sorted) console.log(formatFinding(finding));
      console.log('');
    }
    console.log(
      `共 ${sorted.length} 处：high ${counts.high} / medium ${counts.medium} / low ${counts.low}`
    );
  }

  if (counts.high > 0) process.exitCode = 1;
}

main();
