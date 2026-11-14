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

/** AI 生成内容提示（聊天输入区下方常驻单行） */
export const AI_GENERATED_NOTICE = '回答由 AI 生成，可能存在错误，请核实后使用。';
