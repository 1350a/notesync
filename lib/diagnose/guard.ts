/**
 * 输出纪律后置校验：L2 输出必须引用学生作答原文片段
 *
 * 契约来源：wip-diagnosis-model.md §7.3。这是「诊断 vs 解析」分界线的工程保证，
 * 重试与降级的编排（重试一次不耗追问预算→仍失败降级 L1）在 route 接线层做，本模块只做判定。
 * 判据方式为 A 级假设：连续原文窗口为主、整段 bigram 覆盖兜底；阈值实测可调，不回头改文档。
 * 判定语义是「引用了作答的一个片段」，不要求覆盖整段作答——学生作答往往很长，模型只该锚定关键处。
 */

/** 连续原文窗口长度：输出中出现作答的任意 6 个归一化字符连续段即算引用 */
export const QUOTE_MIN_RUN_CHARS = 6;

/**
 * bigram 兜底通过线：作答片段的字符二元组被输出覆盖的比例（A 级，实测调参）。
 *
 * 为什么是 0.6：归一化已抹掉空白与标点，模型只要在引用处插入一句解释（「你把 x=2 代回去……」）
 * 连续 run 判据就断了，必须靠 bigram 兜底容忍这种局部改写。下限定在 0.6 而非更低，是因为
 * 归一化后的作答片段短且常用汉字二元组重叠严重，0.5 一线时「所以」「这个」这类套话就能凑够覆盖率，
 * 判据会退化成恒真，等于放行不引用的解析。
 *
 * 已知边界：分数是**整段作答**的覆盖率，作答越长、模型只锚定关键处的比例越低，因此本阈值对长作答偏严。
 * 长作答主要靠 QUOTE_MIN_RUN_CHARS 的连续 run 分支命中；若线上出现误判，按作答长度分档调阈值，
 * 不要全局下调——全局下调会先让短作答的套话误判通过。
 */
export const QUOTE_BIGRAM_THRESHOLD = 0.6;

/**
 * 引用匹配归一：NFKC 收全半角、小写、去空白与文字标点。
 * 比较符（<>=≤≥≠）与数学符号必须保留——「>0」改「≥0」是对错关键，不能在归一化里抹平。
 */
export function normalizeForQuote(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}=+\-*/^().<>≤≥≠%√]+/gu, '');
}

/** 字符二元组集合；长度不足 2 时返回空集 */
function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2));
  return grams;
}

/** 片段被输出覆盖的比例（片段 bigram 命中输出 bigram 集合的份额） */
function bigramCoverage(fragment: string, outputGrams: Set<string>): number {
  const grams = [...bigrams(fragment)];
  if (grams.length === 0) return 0;
  const hit = grams.filter((g) => outputGrams.has(g)).length;
  return hit / grams.length;
}

/** 输出中是否存在片段的任意连续 run（长度 QUOTE_MIN_RUN_CHARS）；比整段 includes 宽，比 bigram 严 */
function hasRunInOutput(fragment: string, output: string): boolean {
  if (fragment.length < QUOTE_MIN_RUN_CHARS) {
    // 短片段没有「窗口」可言，整段出现即命中（调用方已过滤更短的）
    return output.includes(fragment);
  }
  for (let start = 0; start + QUOTE_MIN_RUN_CHARS <= fragment.length; start++) {
    if (output.includes(fragment.slice(start, start + QUOTE_MIN_RUN_CHARS))) return true;
  }
  return false;
}

export interface QuoteCheckInput {
  /** 待校验的模型输出（L2 全文） */
  output: string;
  /** 学生作答的各来源文本：打字输入、OCR 结果、wrong 类附件正文；空白来源自动忽略 */
  studentSources: string[];
}

export interface QuoteCheckResult {
  quoted: boolean;
  /** 命中详情，供调试与 trace；未命中时为 null */
  best: {
    /** 命中的学生来源在 studentSources 中的下标 */
    sourceIndex: number;
    via: 'run' | 'bigram';
    /** bigram 命中时的覆盖率；run 命中恒为 1 */
    score: number;
  } | null;
}

/**
 * 判定输出是否引用了至少一处作答原文。
 * 每个学生来源独立判定：先试连续原文窗口（短于窗口长度的来源退化为整段子串——数值答案如
 * "x=2" 本就只有三五个字符，整段出现即是引用），不过且片段够长再试整段 bigram 覆盖。
 */
export function checkAnswerQuote({ output, studentSources }: QuoteCheckInput): QuoteCheckResult {
  const normalizedOutput = normalizeForQuote(output);
  const outputGrams = bigrams(normalizedOutput);

  let best: QuoteCheckResult['best'] = null;
  studentSources.forEach((source, sourceIndex) => {
    const fragment = normalizeForQuote(source);
    if (!fragment) return;

    if (hasRunInOutput(fragment, normalizedOutput)) {
      if (!best) best = { sourceIndex, via: 'run', score: 1 };
      return;
    }
    const score = bigramCoverage(fragment, outputGrams);
    if (score >= QUOTE_BIGRAM_THRESHOLD && (!best || score > best.score)) {
      best = { sourceIndex, via: 'bigram', score };
    }
  });

  return { quoted: best !== null, best };
}
