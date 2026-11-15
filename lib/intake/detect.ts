/**
 * 文件上传统一类型判定（doc/file-intake.md §2~§3）
 *
 * 聊天输入框与诊断页两个入口共用的判据层。图片以魔数为准、不用扩展名：
 * iOS 相册经 Safari 上传时系统把 HEIC 自动转成 JPEG，但文件名可能仍是
 * .HEIC（file-intake.md §12 查证记录），按扩展名会误判。
 * 纯函数，浏览器与 Node（冒烟/单测）共用，不依赖 DOM。
 */

/** 聊天/诊断共用的纯文本扩展白名单（自 ChatInput.tsx 迁入，两入口口径统一） */
export const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log',
  'json', 'jsonl', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'svelte',
  'py', 'ipynb', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs',
  'rb', 'php', 'swift', 'lua', 'pl', 'r', 'm', 'sql',
  'sh', 'bash', 'bat', 'ps1', 'ini', 'toml', 'conf', 'properties', 'tex', 'gitignore',
];

/** 文件入口的扩展白名单后缀（.doc 走服务端端点；xlsx/xls/ppt 拒收并给指引，见 §2/§10） */
const FILE_EXTENSIONS_ACCEPT = [
  ...TEXT_EXTENSIONS.map((ext) => `.${ext}`),
  '.pdf',
  '.docx',
  '.doc',
  '.pptx',
];

/**
 * 文件选择 input 的 accept（doc/file-intake.md §9）。
 * 桌面/拖拽外的对话框过滤用全量白名单（含 image/*——桌面文件对话框只过滤不弹层）；
 * 移动端「选择文件」项必须用 FILE_ACCEPT_NO_IMAGE：accept 含图片类型时手机系统
 * 会先弹「文件/拍照相机」来源选择层，与菜单内「拍照」「从相册选择」两项路径重复
 * （2026-11-14 真机观察）。相册/拍照项各有独立 input，见各入口组件。
 */
export const FILE_ACCEPT = ['image/*', ...FILE_EXTENSIONS_ACCEPT].join(',');
export const FILE_ACCEPT_NO_IMAGE = FILE_EXTENSIONS_ACCEPT.join(',');

/** 客户端可解析的 Office 格式（.doc 走服务端端点；xlsx/xls 暂缓，见 file-intake.md §10） */
export const OFFICE_EXTENSIONS = ['docx', 'pptx'] as const;
export type OfficeFormat = (typeof OFFICE_EXTENSIONS)[number];

/** 图片魔数判定结果 */
export type ImageMagic =
  | 'jpeg' | 'png' | 'webp' | 'bmp' | 'gif' | 'heic' | 'avif' | 'ico' | 'tiff';

/** 接入大类；'pdf' 两入口都接（文字层提取，file-intake.md §7） */
export type IntakeCategory = 'image' | 'text' | 'office' | 'doc' | 'pdf' | 'rejected';

/** 表格文件拒收原因：xlsx/xls 暂缓（2026-11-14 拍板），CSV 走纯文本通道兜底 */
const SHEET_REJECT_REASON = '是表格文件，请另存为 CSV 后上传（Excel 另存 CSV 即可，纯文本通道同样支持中文编码）';

/**
 * 常见图片扩展名（无魔数退化路径用）：正常流程 detectIntake 一定带字节、
 * 走魔数判定；这里只兜 slice 失败/冒烟直跑的场景。jpg 归一为 jpeg。
 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif', 'ico'];

/** 已知图片 MIME 子类型（image/* 但不认识的仍然拒收，不放行） */
const KNOWN_IMAGE_MIME = new Set(['png', 'jpeg', 'jpg', 'webp', 'bmp', 'avif', 'heic', 'heif', 'x-icon', 'vnd.microsoft.icon']);

function imageFormatFromExt(ext: string): string {
  return ext === 'jpg' ? 'jpeg' : ext;
}

export interface IntakeDetection {
  category: IntakeCategory;
  /** 具体格式：图片为魔数结果，office/doc 为扩展名格式，text 为扩展名 */
  format: string;
  /** category === 'rejected' 时的可直接展示原因（不含文件名，调用方拼） */
  reason?: string;
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 图片魔数嗅探（doc/file-intake.md §3 魔数表）；不认识返回 null */
export function sniffImageFormat(b: Uint8Array): ImageMagic | 'ftyp-unknown' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'png';
  }
  // RIFF....WEBP
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'webp';
  }
  // BM + 偏移 14 处 DIB 头长度取已知值：裸 "BM" 会误伤 "BMW..." 这类文本
  if (b.length >= 18 && b[0] === 0x42 && b[1] === 0x4d) {
    const dib = b[14] | (b[15] << 8) | (b[16] << 16) | (b[17] << 24);
    if ([12, 40, 52, 56, 64, 108, 124].includes(dib)) return 'bmp';
  }
  // GIF87a / GIF89a
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return 'gif';
  }
  // ISO-BMFF 容器：'ftyp' 在偏移 4~8，brand 在 8~12（heic/avif/mp4 共用此结构）
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic';
    if (brand === 'avif' || brand === 'avis') return 'avif';
    // mp4 等视频容器也带 ftyp，明确拒绝而不是当图片放行
    return 'ftyp-unknown';
  }
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) {
    return 'ico';
  }
  // II*\0 / MM\0*
  if (
    b.length >= 4 &&
    ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a))
  ) {
    return 'tiff';
  }
  return null;
}

/** OLE 复合文档魔数（doc/xls/ppt 等旧版 Office 二进制的容器格式） */
export function isOleCompoundFile(b: Uint8Array): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
    b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1
  );
}

function rejected(reason: string): IntakeDetection {
  return { category: 'rejected', format: '', reason };
}

/**
 * 统一判定入口。head 为文件前 32 字节（可空：读不动时退化为扩展名/MIME 判定，
 * 纯文本本就没有魔数）。
 */
export function classifyIntake(name: string, mime: string, head: Uint8Array | null): IntakeDetection {
  const ext = extOf(name);

  // 1. 魔数优先：扩展名说谎的场景都在这里拦下（iOS 转码、伪装扩展名）
  if (head && head.length > 0) {
    const magic = sniffImageFormat(head);
    if (magic === 'gif') return rejected('是动图 GIF，请截帧为静态图片后上传');
    if (magic === 'tiff') return rejected('是 TIFF 格式，浏览器无法直接解码，请转成 JPG/PNG 后上传');
    if (magic === 'ftyp-unknown') return rejected('是无法识别的媒体文件，仅支持图片');
    if (magic) return { category: 'image', format: magic };
    if (isOleCompoundFile(head)) {
      if (ext === 'doc') return { category: 'doc', format: 'doc' };
      if (ext === 'xls') return rejected(SHEET_REJECT_REASON);
      if (ext === 'ppt') return rejected('是旧版 PPT 格式，请另存为 pptx 后上传');
      return rejected('是旧版 Office 二进制格式，当前仅支持 doc，请另存为 docx');
    }
    // 魔数不认识 → 继续按扩展名/MIME 判定
  }

  // 2. 扩展名 + MIME（Office 按扩展名：PK 魔数只证明是 ZIP 容器，区分不了具体格式）
  if ((OFFICE_EXTENSIONS as readonly string[]).includes(ext)) {
    return { category: 'office', format: ext };
  }
  if (ext === 'doc') return { category: 'doc', format: 'doc' };
  if (ext === 'ppt') return rejected('是旧版 PPT 格式，请另存为 pptx 后上传');
  if (ext === 'wps') return rejected('是 WPS 文档，请另存为 docx 后上传');
  if (ext === 'xlsx' || ext === 'xls') return rejected(SHEET_REJECT_REASON);
  if (ext === 'gif') return rejected('是动图 GIF，请截帧为静态图片后上传');
  if (ext === 'pdf' || mime === 'application/pdf') return { category: 'pdf', format: 'pdf' };
  if (TEXT_EXTENSIONS.includes(ext) || mime.startsWith('text/')) {
    return { category: 'text', format: ext };
  }
  if (ext === 'svg' || mime === 'image/svg+xml') {
    return rejected('是 SVG 矢量图，请先导出为 PNG/JPG 后上传');
  }
  if (ext === 'heic' || ext === 'heif') {
    // 扩展名是 heic 但没读到魔数：仍给三级阶梯一次机会（file-intake.md §5）
    return { category: 'image', format: 'heic' };
  }
  if (IMAGE_EXTENSIONS.includes(ext)) {
    return { category: 'image', format: imageFormatFromExt(ext) };
  }
  if (mime.startsWith('image/')) {
    const sub = mime.slice('image/'.length);
    if (sub === 'gif') return rejected('是动图 GIF，请截帧为静态图片后上传');
    if (sub === 'svg+xml') return rejected('是 SVG 矢量图，请先导出为 PNG/JPG 后上传');
    if (KNOWN_IMAGE_MIME.has(sub)) {
      const format = sub === 'x-icon' || sub === 'vnd.microsoft.icon' ? 'ico' : imageFormatFromExt(sub);
      return { category: 'image', format };
    }
    return rejected('图片格式无法识别，请转成 JPG/PNG 后上传');
  }
  return rejected('无法识别的文件类型，仅支持图片 / 文本 / Office 文档');
}

/** File → 判定结果：读前 32 字节做魔数嗅探（ftyp brand 在偏移 8~12、BMP DIB 在 14~18） */
export async function detectIntake(file: File): Promise<IntakeDetection> {
  let head: Uint8Array | null = null;
  try {
    head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  } catch {
    head = null; // 读不动就退化为扩展名/MIME 判定，不直接拒收
  }
  return classifyIntake(file.name, file.type ?? '', head);
}
