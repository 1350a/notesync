import { imageLeavesDevice } from '@/lib/ocr/image-handling';
import type { ImageSendMode } from '@/lib/ocr/image-handling';
import type { OcrEngine } from '@/lib/settings/types';
import { imagePrivacyDetail, imagePrivacyShort } from '@/lib/ui/notices';

interface UploadPrivacyNoticeProps {
  /** 当前派生出的图片发送模式（多模态直传 / OCR 转写） */
  mode: ImageSendMode;
  /** 当前转写引擎（设置里的图片处理档） */
  engine: OcrEngine;
  /**
   * short：常驻短句（聊天输入区，一行带过，详细版交给首次上传时的一次性提示）
   * detail：完整三点说明（诊断上传区，区域内空间足够，上传前就能看全）
   */
  variant?: 'short' | 'detail';
}

/**
 * 上传前隐私提醒（图片维度）。
 *
 * 为什么由组件自己判定而不是调用方传文案：提醒必须与真实发送路径同源——
 * 「图片是否出设备」由 lib/ocr/image-handling.ts 的 imageLeavesDevice 判定，
 * 组件把它写进 data 属性供用例断言，避免「文案说本地、实现走云端」的漂移。
 *
 * 纯展示：无 state、不发请求、不读 store（mode/engine 由调用方从设置与模型能力派生）。
 */
export default function UploadPrivacyNotice({
  mode,
  engine,
  variant = 'short',
}: UploadPrivacyNoticeProps) {
  const leavesDevice = imageLeavesDevice(mode, engine);
  return (
    <p
      data-privacy-remote={leavesDevice ? 'true' : 'false'}
      className={`px-2 leading-snug text-muted-foreground ${
        variant === 'detail' ? 'text-xs' : 'text-[10px]'
      }`}
    >
      {variant === 'detail' ? imagePrivacyDetail(mode, engine) : imagePrivacyShort(mode, engine)}
    </p>
  );
}
