/**
 * 诊断模式文件接入 - 消息组装（纯函数）
 *
 * 产出一条 user 消息：四类标签按"原题 → 错误答案 → 正确答案 → 标准解析"的固定顺序
 * 分块，每块先给文字锚点，再挂该块的文件内容，保证模型能分辨哪段属于哪一类。
 *
 * 文本预算按参与文件数均分（默认总量 8000 字符），避免一份长 PDF 吃掉全部额度、
 * 把其它文件挤成空段。图片上限默认 4 张，超出的明确降级为文字占位而不是静默丢弃。
 */
import type { ProviderImagePart, ProviderTextPart } from '../provider/types.ts';
import type {
  AssembleOptions,
  AssembleResult,
  DiagnoseAttachment,
  ReviseCategory,
} from './types.ts';

const DEFAULT_MAX_IMAGES = 4;
const DEFAULT_TOTAL_CHARS = 8000;
const DEFAULT_MIN_CHARS = 200;

/** 分块顺序即投喂顺序，改动会直接影响模型对题面/答案/解析的先后理解 */
const CATEGORY_ORDER: ReviseCategory[] = ['origin', 'wrong', 'correct', 'analysis'];

const CATEGORY_ANCHOR: Record<ReviseCategory, string> = {
  origin: '【错题原题】',
  wrong: '【我的错误答案】',
  correct: '【正确答案】',
  analysis: '【标准解析】',
};

const CATEGORY_HINT: Record<ReviseCategory, string> = {
  origin: '以下是我上传的错题原题，用于识别考点与我的解题偏差。',
  wrong: '以下是我当时给出的错误答案。',
  correct: '以下为本题的正确答案。',
  analysis: '以下为本题的标准解析。',
};

/** 判断一个文件是否走文本通道（有文字、无图片数据） */
function isTextItem(item: DiagnoseAttachment): boolean {
  return !item.dataUrl?.trim() && Boolean(item.text?.trim());
}

/**
 * 组装诊断消息。
 * @returns message 为 null 表示没有任何可发送内容，调用方应据此拒绝请求
 */
export function assembleDiagnoseMessage(
  items: DiagnoseAttachment[],
  options: AssembleOptions = {}
): AssembleResult {
  const imageMode = options.imageMode ?? 'multimodal';
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const totalChars = options.totalChars ?? DEFAULT_TOTAL_CHARS;
  const minCharsPerFile = options.minCharsPerFile ?? DEFAULT_MIN_CHARS;

  const warnings: string[] = [];
  const parts: (ProviderTextPart | ProviderImagePart)[] = [];
  let images = 0;
  let texts = 0;
  let chars = 0;

  if (items.length === 0) {
    return { message: null, stats: { images, texts, chars }, warnings };
  }

  // 预算按"真正走文本通道的文件数"均分，纯图片不占额度
  const textCount = items.filter(isTextItem).length;
  const perFile =
    textCount > 0 ? Math.max(minCharsPerFile, Math.floor(totalChars / textCount)) : 0;

  for (const category of CATEGORY_ORDER) {
    const group = items.filter((item) => item.category === category);
    if (group.length === 0) continue;

    parts.push({
      type: 'text',
      text: `${CATEGORY_ANCHOR[category]}（${group.length} 个文件）\n${CATEGORY_HINT[category]}`,
    });

    for (const item of group) {
      if (item.warning) warnings.push(`${item.name}：${item.warning}`);

      const dataUrl = item.dataUrl?.trim();
      if (dataUrl) {
        if (imageMode === 'multimodal' && images < maxImages) {
          parts.push({ type: 'image_url', image_url: { url: dataUrl } });
          images += 1;
        } else {
          const why = imageMode === 'multimodal' ? '超出图片数量上限' : '当前模型不支持图片输入';
          parts.push({ type: 'text', text: `[图片 ${item.name}]（${why}，未发送图像本体）` });
          warnings.push(`${item.name}：${why}，已降级为文字占位`);
        }
        continue;
      }

      const body = item.text?.trim();
      if (!body) {
        warnings.push(`${item.name}：未提取到可用内容`);
        continue;
      }

      const clipped = body.slice(0, perFile);
      const truncated = body.length > clipped.length;
      // 正文前置文件名：同组多文件连排时，模型需要靠它区分内容属于哪一份
      parts.push({
        type: 'text',
        text: truncated
          ? `[文件 ${item.name}]\n${clipped}\n……（内容过长，已截断）`
          : `[文件 ${item.name}]\n${clipped}`,
      });
      texts += 1;
      chars += clipped.length;
      if (truncated) warnings.push(`${item.name}：超出单文件 ${perFile} 字符预算，已截断`);
    }
  }

  return {
    message: { role: 'user', content: parts },
    stats: { images, texts, chars },
    warnings,
  };
}
