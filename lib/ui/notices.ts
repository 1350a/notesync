/**
 * 面向用户的固定提示文案（纯常量 + 纯函数，无状态、无副作用、不发请求）。
 *
 * 为什么要单独一层：这些文案是**红线承诺**，改动必须同时过测试
 * （test/ui/notices.test.ts）。文案散在各组件里内联时，改提示词/改 UI 的人
 * 很容易顺手改掉或删掉一句，测试无法锚定。集中成常量后，文案只有一处定义，
 * 组件只负责摆放（components/chat/AiGeneratedNotice.tsx、
 * components/upload/UploadPrivacyNotice.tsx）。
 *
 * 口径来源：
 * - AI 生成提示：合规章节要求「AI 生成内容需可识别」，但同时必须对用户有用——
 *   只写「内容由 AI 生成」等于免责套话，因此带上「可能存在错误，请核实后使用」。
 * - 隐私提示：doc/file-intake.md §1「隐私口径（UI 文案必须照实表述）」+
 *   doc/cloud-ocr.md §3「设备边界与同意」。**不得夸大**：本站服务端只做代理转发、
 *   不落盘保存（app/api/ocr/route.ts、app/api/chat/route.ts 均无持久化），
 *   第三方服务商侧的留存与训练策略由服务商条款决定
 *   （components/settings/AgreementSection.tsx 已作同口径声明），
 *   因此文案只承诺「本站不留存」，不替服务商承诺「不用于训练」。
 */
import type { ImageSendMode } from '@/lib/ocr/image-handling';
import type { OcrEngine } from '@/lib/settings/types';

/** AI 生成内容提示（聊天输入区下方常驻单行） */
export const AI_GENERATED_NOTICE = '回答由 AI 生成，可能存在错误，请核实后使用。';

/** 设置页跳转指引（隐私提示里给可执行动作，而不是泛泛免责） */
export const PRIVACY_SETTINGS_HINT = '设置 › 本地能力 › 图片处理';

/**
 * 上传隐私提示 · 常驻短句（引擎=云端，或模型多模态直传：内容必然出设备）。
 *
 * 「本站不保存」是本仓库可自证的（app/api/ocr、app/api/chat 均无持久化），
 * 服务商侧的留存/训练策略不作承诺——见文件头口径说明。
 */
export const PRIVACY_SHORT_REMOTE =
  '隐私提醒：图片与文件会发送至第三方模型服务商处理，本站不保存；如需内容不出设备，可在「设置 › 本地能力」切换本地识别。';

/** 上传隐私提示 · 常驻短句（本地引擎 + OCR 转写：原图不出设备，只有文字出设备） */
export const PRIVACY_SHORT_LOCAL =
  '隐私提醒：图片在浏览器内识别，原图不出设备；识别出的文字会随消息发送至第三方模型服务商处理。';

/** 首次上传一次性提示 · 图片走云端 OCR（默认档） */
export const PRIVACY_DETAIL_IMAGE_CLOUD =
  '隐私提醒：本次图片会经本站服务端代理上传到第三方模型服务商（智谱 glm-ocr）识别为文字，本站服务端只做转发、不保存图片；服务商是否留存或用于训练以其服务条款为准。如需图片不出设备，请在「设置 › 本地能力 › 图片处理」切到「本地」。';

/** 首次上传一次性提示 · 图片多模态原图直传 */
export const PRIVACY_DETAIL_IMAGE_DIRECT =
  '隐私提醒：当前模型支持图片，本次将原图上传到第三方模型服务商处理，本站服务端只做转发、不保存图片；服务商是否留存或用于训练以其服务条款为准。如需图片不出设备，请改用纯文本模型，并在「设置 › 本地能力 › 图片处理」切到「本地」。';

/** 首次上传一次性提示 · 图片本地引擎转写（原图不出设备） */
export const PRIVACY_DETAIL_IMAGE_LOCAL =
  '本地上报：本次图片在浏览器内识别为文字后随消息发送，原图不出设备；识别出的文字仍会发送至第三方模型服务商处理。引擎可在「设置 › 本地能力 › 图片处理」调整。';

/** 首次上传一次性提示 · 普通文件（浏览器内解析成文字） */
export const PRIVACY_DETAIL_FILE =
  '隐私提醒：文件在浏览器内解析成文字，解析结果随消息发送至第三方模型服务商处理（本站不保存文件；服务商是否留存或用于训练以其服务条款为准）。';

/** 首次上传一次性提示 · 旧版 .doc（先上传本站服务端解析） */
export const PRIVACY_DETAIL_DOC =
  '隐私提醒：旧版 .doc 无法在浏览器内解析，需先上传到本站服务端解析成文字（本站解析、不涉及第三方、不保存文件），解析结果再随消息发送至第三方模型服务商处理。';

/** 图片隐私常驻短句：按「模式 × 引擎」派生（本地+转写才是原图不出设备） */
export function imagePrivacyShort(mode: ImageSendMode, engine: OcrEngine): string {
  return mode === 'ocr-text' && engine === 'local' ? PRIVACY_SHORT_LOCAL : PRIVACY_SHORT_REMOTE;
}

/** 图片隐私详细提示：按「模式 × 引擎」派生 */
export function imagePrivacyDetail(mode: ImageSendMode, engine: OcrEngine): string {
  if (mode === 'direct') return PRIVACY_DETAIL_IMAGE_DIRECT;
  return engine === 'local' ? PRIVACY_DETAIL_IMAGE_LOCAL : PRIVACY_DETAIL_IMAGE_CLOUD;
}

/** 文件隐私详细提示：只有 .doc 需经本站服务端，其余在浏览器内解析 */
export function filePrivacyDetail(kind: 'doc' | 'other' = 'other'): string {
  return kind === 'doc' ? PRIVACY_DETAIL_DOC : PRIVACY_DETAIL_FILE;
}
