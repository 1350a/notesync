/**
 * 诊断模式文件接入 - 类型判定
 *
 * 2026-11-14 起委派 `lib/intake/detect.ts`（doc/file-intake.md §3）：魔数判定、
 * 编码与图片契约在聊天/诊断两个入口统一，本文件只负责映射到诊断侧的
 * DiagnoseKind 与组装用户可读的拒收原因。判定细则（魔数表、iOS HEIC 转码
 * 陷阱、Office 按扩展名的原因）见 intake 模块与协议文档。
 */
import { classifyIntake, detectIntake, type IntakeDetection } from '../intake/detect.ts';
import type { DetectResult } from './types.ts';

/** intake 判定 → 诊断侧 DetectResult；rejected 时拼接文件名成完整原因 */
function toDetectResult(detection: IntakeDetection, name: string): DetectResult {
  switch (detection.category) {
    case 'image':
      return { kind: 'image', supported: true, mime: `image/${detection.format}`, format: detection.format };
    case 'pdf':
      return { kind: 'pdf', supported: true, mime: 'application/pdf', format: 'pdf' };
    case 'text':
      return { kind: 'text', supported: true, mime: 'text/plain', format: detection.format };
    case 'office':
      return {
        kind: 'office',
        supported: true,
        mime: `application/${detection.format}`,
        format: detection.format,
      };
    case 'doc':
      return { kind: 'doc', supported: true, mime: 'application/msword', format: 'doc' };
    case 'rejected':
      return {
        kind: 'unsupported',
        supported: false,
        mime: '',
        reason: `${name}：${detection.reason ?? '无法识别的文件类型'}`,
      };
  }
}

/** File → 判定结果（读前 32 字节做魔数嗅探）；UploadArea 的唯一入口 */
export async function detectFile(file: File): Promise<DetectResult> {
  return toDetectResult(await detectIntake(file), file.name);
}

/**
 * 同步判定入口：冒烟/单测没有 File 对象，直接喂 (name, mime, head)。
 * head 缺省 null 时退化为扩展名/MIME 判定（与 intake 的 classifyIntake 同口径）。
 */
export function detectFileSync(
  name: string,
  mime: string,
  head: Uint8Array | null = null
): DetectResult {
  return toDetectResult(classifyIntake(name, mime, head), name);
}
