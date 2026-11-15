/**
 * 图片接入提取（doc/file-intake.md §5~§6）
 *
 * 职责：heic 三级阶梯（canvas 原生解码 → heic2any → 拒收）、格式规范化
 * （非 JPG/PNG 转 PNG/JPEG，云 OCR 门禁只吃这两种）、尺寸缩放（防
 * MAX_DATA_URL 12MB 丢弃、OCR 提速）。只允许在客户端组件调用
 * （依赖 Image/canvas/FileReader）。
 */
import { sniffImageFormat, type ImageMagic } from './detect.ts';

/** 原始字节超过该值触发缩放 */
const RESIZE_INPUT_BYTES = 4 * 1024 * 1024;
/** 最长边超过该值触发缩放 */
const RESIZE_INPUT_EDGE = 4096;
/** 缩放后的最长边（错题照片/试卷截图足够） */
const RESIZE_TARGET_EDGE = 2048;
const JPEG_QUALITY = 0.92;

export interface ImageIntakeSuccess {
  ok: true;
  /** 规范化后的 dataUrl，恒为 data:image/png|jpeg 前缀 */
  dataUrl: string;
  /** 规范化后的格式 */
  format: 'png' | 'jpeg';
  /** 魔数判定的原始格式（UI 留痕用） */
  originalFormat: string;
  /** 是否发生了缩放 */
  resized: boolean;
}

export interface ImageIntakeFailure {
  ok: false;
  reason: string;
}

export type ImageIntakeResult = ImageIntakeSuccess | ImageIntakeFailure;

/** File → dataUrl（诊断页 extract 原有实现迁入共用） */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取转码结果失败'));
    reader.readAsDataURL(blob);
  });
}

/** dataUrl → 解码完成的 Image；decode() 失败（含格式不支持）直接抛 */
async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

/** 规范化输出格式：bmp/透明系保 PNG（截图文字锐利），照片系转 JPEG */
function normalizedOutputFormat(format: ImageMagic): 'png' | 'jpeg' {
  return format === 'png' || format === 'bmp' ? 'png' : 'jpeg';
}

/**
 * 主流程：解码（含 heic 阶梯）→ 按需缩放/规范化 → 产出 dataUrl。
 * detect 已拒掉的格式在这里再拦一次（粘贴等未经 detect 的路径）。
 */
export async function extractImageIntake(file: File): Promise<ImageIntakeResult> {
  let format: string;
  try {
    const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    const magic = sniffImageFormat(head);
    if (magic === 'gif') return { ok: false, reason: '是动图 GIF，请截帧为静态图片后上传' };
    if (magic === 'tiff') return { ok: false, reason: '是 TIFF 格式，请转成 JPG/PNG 后上传' };
    if (magic === 'ftyp-unknown' || magic === null) {
      return { ok: false, reason: '图片格式无法识别，请转成 JPG/PNG 后上传' };
    }
    format = magic;
  } catch {
    return { ok: false, reason: '读取文件失败，请重试' };
  }

  let dataUrl: string;
  try {
    dataUrl = await readAsDataUrl(file);
  } catch {
    return { ok: false, reason: '读取文件失败，请重试' };
  }

  // 解码：heic 走三级阶梯（file-intake.md §5），其余格式一次解码
  let img: HTMLImageElement | null = null;
  if (format === 'heic') {
    // 级 1：浏览器原生解码（iOS 17+ / Safari 支持 HEIC）
    try {
      img = await loadImage(dataUrl);
    } catch {
      img = null;
    }
    // 级 2：heic2any（libheif wasm ~2MB，动态加载，仅走到这里才拉）
    if (!img) {
      try {
        const heic2any = (await import('heic2any')).default;
        const output = await heic2any({ blob: file, toType: 'image/jpeg', quality: JPEG_QUALITY });
        const blob = Array.isArray(output) ? output[0] : output;
        dataUrl = await blobToDataUrl(blob);
        format = 'jpeg';
        img = await loadImage(dataUrl);
      } catch {
        // 级 3：拒收，由调用方展示
        return { ok: false, reason: 'HEIC 解码失败，请转成 JPG/PNG 后上传' };
      }
    }
  } else {
    try {
      img = await loadImage(dataUrl);
    } catch {
      return { ok: false, reason: '图片解码失败，文件可能已损坏' };
    }
  }

  const edge = Math.max(img.naturalWidth, img.naturalHeight);
  // dataUrl base64 段还原出的原始字节数（4/3 膨胀）
  const byteLength = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
  const needsResize = edge > RESIZE_INPUT_EDGE || byteLength > RESIZE_INPUT_BYTES;

  // JPG/PNG 且不需要缩放：原样保留，不重编码（避免 JPEG 二次有损）
  if (!needsResize && (format === 'jpeg' || format === 'png')) {
    return { ok: true, dataUrl, format, originalFormat: format, resized: false };
  }

  const outFormat = normalizedOutputFormat(format as ImageMagic);
  const scale = needsResize ? Math.min(1, RESIZE_TARGET_EDGE / edge) : 1;
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: '浏览器 canvas 不可用，无法处理图片' };
  // JPEG 无透明通道：垫白底，避免透明区域变黑
  if (outFormat === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  // drawImage 按 EXIF 方向绘制（浏览器 image-orientation 默认 from-image）
  ctx.drawImage(img, 0, 0, width, height);
  const normalized = canvas.toDataURL(outFormat === 'png' ? 'image/png' : 'image/jpeg', JPEG_QUALITY);
  return {
    ok: true,
    dataUrl: normalized,
    format: outFormat,
    originalFormat: format,
    resized: needsResize,
  };
}
