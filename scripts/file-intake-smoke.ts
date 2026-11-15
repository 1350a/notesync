/**
 * 文件上传统一接入冒烟（Node ≥20 原生 strip-types，零依赖直跑）
 *
 * 运行：`npm run smoke:intake` 或 `node --experimental-strip-types scripts/file-intake-smoke.ts`
 *
 * 覆盖（doc/file-intake.md §11）：
 * 1. detectIntake：真实 File 对象 + 前 32 字节魔数嗅探（含 iOS HEIC 转码陷阱）
 * 2. decodeTextFile：编码探测端到端（GBK / UTF-16 / 二进制拒收）
 * 3. /api/parse-doc 服务端校验与错误路径：dataUrl 校验、OLE 魔数、
 *    word-extractor 拒析非 Word OLE 容器（真 .doc 解析需真实文件，留实机验收）
 *
 * 注意：本脚本被 node strip-types 直跑，被 import 的 lib 模块不得使用
 * 参数属性 / enum / namespace 等需要转换的语法。
 */
import { decodeTextBuffer, decodeTextFile } from '../lib/intake/decode-text.ts';
import { classifyIntake, detectIntake } from '../lib/intake/detect.ts';
import { ParseDocError, parseDocBuffer, parseDocDataUrl } from '../lib/parse/doc.ts';

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

/** 构造浏览器同构的 File（Node ≥20 全局） */
function makeFile(bytes: Uint8Array, name: string, type = ''): File {
  return new File([bytes as BlobPart], name, { type });
}

/** Buffer → 独立 ArrayBuffer（Buffer 本体不是 ArrayBuffer 的实例类型） */
function ab(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

console.log('\n[1] detectIntake：File + 魔数嗅探');
{
  // iOS 相册经 Safari 转码：内容已是 JPEG，文件名可能仍是 .HEIC
  const iosFile = makeFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), 'IMG_0001.HEIC', 'image/jpeg');
  const iosResult = await detectIntake(iosFile);
  assert(iosResult.category === 'image' && iosResult.format === 'jpeg', 'iOS 转码陷阱：.HEIC 名 + JPEG 魔数按 JPEG 放行');

  const gifFile = makeFile(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'a.gif', 'image/gif');
  const gifResult = await detectIntake(gifFile);
  assert(gifResult.category === 'rejected' && (gifResult.reason ?? '').includes('截帧'), 'gif 魔数拒收并给出截帧指引');

  const oleDoc = makeFile(
    new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(24)]),
    'a.doc'
  );
  assert((await detectIntake(oleDoc)).category === 'doc', 'OLE 魔数 + .doc 走服务端解析');

  // 无魔数的同步退化路径
  assert(classifyIntake('a.docx', '', null).category === 'office', '无魔数退化：.docx 按扩展名归 office');
}

console.log('\n[2] decodeTextFile：编码探测端到端');
{
  // '中'=D6D0 '文'=CEC4（GBK 标准码位，Node 无 GBK 编码器只能手工构造）
  const gbkFile = makeFile(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), 'ansi.txt');
  const gbkResult = await decodeTextFile(gbkFile);
  assert(gbkResult.ok && gbkResult.encoding === 'gb18030' && gbkResult.text === '中文', 'GBK 字节落 GB18030 兜底不乱码');

  const utf16Buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文', 'utf16le')]);
  const utf16Result = await decodeTextFile(makeFile(new Uint8Array(utf16Buf), 'unicode.txt'));
  assert(utf16Result.ok && utf16Result.encoding === 'utf-16le' && utf16Result.text === '中文', 'UTF-16LE BOM 解码');

  const plain = await decodeTextBuffer(ab(Buffer.from('plain', 'utf8')));
  assert(plain.ok && plain.encoding === 'utf-8', '无 BOM UTF-8 直接解码');

  const binary = await decodeTextBuffer(ab(Buffer.alloc(128, 0)));
  assert(!binary.ok, '全 NUL 判二进制拒收');
}

console.log('\n[3] /api/parse-doc 服务端校验与错误路径');
{
  let threw = false;
  try {
    parseDocDataUrl('not-a-dataurl');
  } catch (err) {
    threw = err instanceof ParseDocError && err.code === 'unsupported_format';
  }
  assert(threw, '非 base64 dataUrl → unsupported_format');

  threw = false;
  try {
    parseDocDataUrl(`data:application/msword;base64,${Buffer.from('plain').toString('base64')}`);
  } catch (err) {
    threw = err instanceof ParseDocError && err.code === 'unsupported_format';
  }
  assert(threw, 'OLE 魔数不符 → unsupported_format');

  // 手工 OLE 头：魔数匹配应放行（服务端只校验前 8 字节，真伪 .doc 由 word-extractor 判）
  const oleBytes = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(56),
  ]);
  const buffer = parseDocDataUrl(`data:application/msword;base64,${oleBytes.toString('base64')}`);
  assert(buffer.length === oleBytes.length, 'OLE 魔数匹配放行');

  let rejectedParse = false;
  try {
    await parseDocBuffer(buffer);
  } catch (err) {
    rejectedParse = err instanceof ParseDocError && err.code === 'parse_error';
  }
  assert(rejectedParse, '非 Word 的 OLE 容器在解析阶段报 parse_error');
}

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
