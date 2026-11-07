/**
 * 诊断模式文件接入 - 共享类型
 *
 * 链路四段：detect（能不能收） → extract（取出内容） → assemble（拼模型消息） → send（POST /api/chat）
 * 本文件只放类型定义，浏览器侧与 Node 冒烟脚本共用，不得引入运行时依赖。
 */
import type { ProviderMessage } from '../provider/types.ts';

/** 文件种类：图片 / PDF / Word / 纯文本 / 无法识别 */
export type DiagnoseKind = 'image' | 'pdf' | 'doc' | 'text' | 'unsupported';

/** 四类上传标签，UI 下拉与组装锚点一一对应 */
export type ReviseCategory = 'origin' | 'wrong' | 'correct' | 'analysis';

/** detect 判定结果 */
export interface DetectResult {
  kind: DiagnoseKind;
  /** 本轮链路是否接得住；false 时 reason 必须是可直接展示给用户的中文原因 */
  supported: boolean;
  /** 归一后的 MIME（扩展名推断优先，缺失时用传入 MIME 兜底） */
  mime: string;
  reason?: string;
}

/**
 * 提取完成后的单个文件，同时是 /api/chat 请求体 attachments 的元素形态。
 * 图片走 dataUrl，PDF/纯文本走 text，二者互斥。
 */
export interface DiagnoseAttachment {
  name: string;
  category: ReviseCategory;
  /** 图片 dataUrl，形如 data:image/png;base64,... */
  dataUrl?: string;
  /** PDF / 纯文本提取出的正文 */
  text?: string;
  /** 提取阶段的降级原因；单文件失败不阻断整批组装 */
  warning?: string;
}

/** 图片投喂方式：多模态直传 / 纯文本模型下退化为文字占位 */
export type AssembleImageMode = 'multimodal' | 'text-only';

export interface AssembleOptions {
  /** 默认 multimodal */
  imageMode?: AssembleImageMode;
  /** 图片张数上限，默认 4；超出部分丢弃并记 warning */
  maxImages?: number;
  /** 文本总字符预算，按参与文件数均分，默认 8000 */
  totalChars?: number;
  /** 均分后单文件下限，默认 200 */
  minCharsPerFile?: number;
}

export interface AssembleStats {
  /** 实际投喂给模型的图片张数 */
  images: number;
  /** 实际投喂的文本块数 */
  texts: number;
  /** 实际占用字符数 */
  chars: number;
}

export interface AssembleResult {
  /** 组装出的单条 user 消息；无任何有效内容时为 null */
  message: ProviderMessage | null;
  stats: AssembleStats;
  warnings: string[];
}
