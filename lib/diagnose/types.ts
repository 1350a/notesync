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

// ---------------------------------------------------------------------------
// 诊断核心契约（diagnosis-model.md §4.1/§6 + agent-workflow.md §2）
// 接口形状为硬项：字段变更须同批更新对应文档。
// ---------------------------------------------------------------------------

import type { ErrorCode } from './error-causes.ts';

/** 策略卡：错因 → 干预策略，直查不检索（diagnosis-model.md §4.1） */
export interface StrategyCard {
  /** 对应错因表的 code（§3） */
  errorCode: ErrorCode;
  /** 稳定标识，供前端与统计引用；不含版本号，版本由 version 字段独立表达 */
  id: string;
  /** 3~5 条可执行动作 */
  steps: string[];
  subject: 'math';
  /** 结构变更时递增，历史结论需可比 */
  version: number;
}

/** 完整度四要素（diagnosis-model.md §1.1：仅 hasProblem 必需；hasAnalysis 只留痕，不参与门槛判定） */
export interface DiagnosisCompleteness {
  hasProblem: boolean;
  hasStudentAnswer: boolean;
  hasCorrectAnswer: boolean;
  hasAnalysis: boolean;
}

/** 单次归因引用：主错因 1 个必带置信度，最多再加 1 个次错因（§3.1） */
export interface ErrorCauseRef {
  code: ErrorCode;
  /** 0~1，模型自评；判定依据待实测（§8 待办） */
  confidence: number;
}

/** 提示阶梯单级（§5）；「完整解」不在枚举内——仅用户明确索取时输出，不进结构 */
export interface HintStep {
  level: 1 | 2 | 3;
  content: string;
}

/** 诊断输出结构（diagnosis-model.md §6）；对话模式与整卷模式共用，差别只在渲染层 */
export interface DiagnosisResult {
  subject: 'math';
  level: 'L1' | 'L2';
  completeness: DiagnosisCompleteness;
  /** 考点，1~3 条 */
  knowledgePoints: string[];
  /** L1 时为 null，不硬编错因 */
  errorCause: ErrorCauseRef | null;
  secondaryErrorCause?: ErrorCauseRef;
  /** L2 才有；服务端按 errorCause.code 从策略卡常量表直查注入，模型不产卡 */
  strategy: StrategyCard | null;
  hints: HintStep[];
  /** 如「未提供作答，本次不做错因归因」 */
  notes?: string;
  /** 与策略卡表 STRATEGY_VERSION 对齐 */
  strategyVersion: number;
}

/** 诊断状态机七状态（agent-workflow.md §2 裁剪：strategize 并入 diagnose——策略卡按错因直查，独立状态不产生新输入） */
export type DiagnoseState =
  | 'intake' // 收题：判定有无原题、是否数学
  | 'clarify' // 补问：作答缺失或置信度不足时追问（有预算）
  | 'diagnose' // L2 归因，策略卡组装并入此状态
  | 'explain' // 提示阶梯输出与掌握度回路
  | 'L1_only' // 拒绝补充/预算耗尽：只出题目画像 + 声明
  | 'reject' // 非数学题：固定话术 + 能力说明
  | 'done';

/** 学科标识；v1 仅数学，多学科时在此扩联合（product-vision.md §2 非目标） */
export type DiagnoseSubject = 'math';

/**
 * 状态机上下文。服务端无会话，历史由前端全量上送，
 * 本结构由客户端持久（随 ChatMsg 存）并在每次请求时携带，服务端严格校验。
 */
export interface DiagnoseContext {
  subject: DiagnoseSubject;
  state: DiagnoseState;
  /** 已消耗追问轮次（初始补问与置信度不足回炉同计），达预算强制收敛（agent-workflow.md §4.1） */
  clarifyUsed: number;
  /** explain 当前所处提示阶梯层级，逐级下降用 */
  hintLevel: 1 | 2 | 3;
}

/** 状态机输入事件；实现为纯函数，迁移语义见 agent-workflow.md §2 迁移表 */
export type DiagnoseEvent =
  /** intake 完成：有无原题、是否数学题 */
  | { type: 'intake_done'; hasProblem: boolean; isMath: boolean }
  /** clarify 一轮结束：是否拿到作答 / 用户是否明确拒绝补充 */
  | { type: 'clarify_done'; hasAnswer: boolean; refused: boolean }
  /**
   * diagnose 完成，三态出口：
   * confident 达标进 explain；low_confidence 预算有余回 clarify 一次、耗尽走低置信输出；
   * guard_failed 作答引用判据两试不过，降级 L1（diagnosis-model.md §7.3）
   */
  | { type: 'diagnosis_done'; outcome: 'confident' | 'low_confidence' | 'guard_failed' }
  /** explain：用户点「继续」或「还不懂」→ 降一级 */
  | { type: 'hint_descend' }
  /** explain：用户点「明白了」→ done */
  | { type: 'mastered' }
  /** 用户明确终止或转换话题：任何状态都放行到 done，不纠缠 */
  | { type: 'user_stop' }
  /** L1_only / reject 输出完成 */
  | { type: 'output_done' };

/**
 * 诊断模式请求负载（/api/chat 请求体 diagnose 字段，服务端经 runtime.parseDiagnosePayload 严格校验）。
 * context 由客户端持久并回传；event 仅限「模型调用前就能确定」的白名单——
 * intake_done / diagnosis_done / output_done 由服务端在响应后自行推导，客户端不得伪造。
 */
export type DiagnoseRequestEvent =
  | { type: 'clarify_done'; hasAnswer: boolean; refused: boolean }
  | { type: 'hint_descend' }
  | { type: 'mastered' }
  | { type: 'user_stop' };

export interface DiagnoseRequestPayload {
  context?: DiagnoseContext;
  event?: DiagnoseRequestEvent;
}
