/**
 * 提示注入（prompt injection）句式特征库
 *
 * 【防护目标】本文件只做一件事：识别「试图改写系统指令」的输入——请求忽略既有指令、
 * 冒充或重置角色、索取系统提示/内部规则、伪造对话分隔符、要求进入无限制模式、
 * 索取密钥与后台配置。命中即由调用方按注入处置（服务端硬拒，见 app/api/chat/route.ts）。
 *
 * 【明确不做的事：不在内容层做词表审查】
 * 本文件不判断用户「说了什么内容」是否敏感，也不维护任何敏感词/违禁词清单。
 * 不做内容层词表审查是设计决策（理由见 doc/safety-design.md §3）：
 * 1. 词表永远不全——漏一个就等于对外宣称「已覆盖」，却给不出覆盖证明；
 * 2. 中文同音、拼音、拆字、繁简混写的绕过成本极低，维护方要持续追热点，成本不封顶；
 * 3. 学科文本天然撞词——物理的「爆炸/燃烧」、化学的「制取/配比」、生物的「麻醉/毒理」
 *    都是正当题干，词表一刀切会把正常错题挡在门外；
 * 4. 违规内容判定本就有上游承担（content_blocked），服务端再叠一层词表只增加误伤面。
 *
 * 【判定口径】只认「指令结构」，不看单个词是否刺眼：
 * 单条输入通常需要同时出现「动作」（忽略/输出/扮演）+「对象」（指令/系统提示/角色）
 * 才算命中，避免「忽略不计」「假设没有摩擦」这类正常题干被误伤。
 *
 * 【可维护性】条目按 id 编号，新增条目只需追加对象，不改调用方；
 * 归一化（去零宽字符、全角转半角）在匹配前统一执行，防止最廉价的绕过手法。
 */

/** 一条注入特征：id 用于日志与 trace 归因，label 用于服务端日志与审查材料 */
export interface InjectionPattern {
  id: string;
  /** 中文说明（写日志、做审查证据时直接可读） */
  label: string;
  pattern: RegExp;
}

/**
 * 中英文提示注入句式（15 条）。
 *
 * 覆盖的攻击面：指令覆盖（1-3）、角色重置与越狱（4-6）、提示词套取（7-8）、
 * 伪系统标记（9）、优先级篡改（10）、纪律解除（11）、原文回显（12）、
 * 凭据套取（13）、英文无限制表述（14-15）。
 */
export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    id: 'ignore_instructions',
    label: '要求忽略既有指令/设定',
    pattern:
      /(忽略|无视|忘记|忘掉|抛开|跳过|不理会|不要管)[^。！？\n]{0,10}(指令|提示|设定|规则|要求|约束|限制|提示词|prompt|instruction)/i,
  },
  {
    id: 'ignore_instructions_en',
    label: '要求忽略既有指令（英文）',
    pattern:
      /(ignore|disregard|forget|bypass)[^.\n]{0,20}(previous|above|prior|earlier|foregoing|system|all)[^.\n]{0,12}(instruction|prompt|rule|direction|constraint)/i,
  },
  {
    id: 'forget_everything_en',
    label: '要求忘记此前所有交代（英文）',
    pattern: /forget[^.\n]{0,12}(everything|all)[^.\n]{0,24}(told|said|above|before|given)/i,
  },
  {
    id: 'role_reset',
    label: '重置或冒充角色身份',
    pattern:
      /(你现在|从现在开始|从现在起|接下来你|之后你|以后你)[^。！？\n]{0,16}(扮演|充当|作为|变成|是)[^。！？\n]{0,20}(助手|管理员|开发者|专家|角色|模型|AI|人工智能|机器人)/i,
  },
  {
    id: 'no_restriction_assumption',
    label: '假设存在无限制状态',
    pattern:
      /(假设|假装|想象|就当|模拟|设定)[^。！？\n]{0,16}(没有|不存在|不受|无需|不必|取消)[^。！？\n]{0,10}(限制|约束|规则|审查|安全|过滤|纪律)/,
  },
  {
    id: 'jailbreak_keyword',
    label: '越狱/开发者模式类关键词',
    pattern:
      /(developer\s*mode|jailbreak|do\s*anything\s*now|\bDAN\b|越狱|开发者模式|上帝模式|无限制模式|管理员模式|调试模式|debug\s*mode)/i,
  },
  {
    id: 'prompt_leak_request',
    label: '索取系统提示/内部指令',
    // 两种语序都要覆盖：「输出系统提示词」与「把系统提示词完整输出一遍」
    pattern:
      /(输出|打印|显示|复述|重复|回显|告诉我|展示|泄露|贴出|写出|列出|读一下)[^。！？\n]{0,16}(系统提示|系统指令|system\s*prompt|系统设定|初始提示|内部指令|内部规则|提示词|prompt|你的指令|你的设定)|(系统提示|系统指令|system\s*prompt|内部指令|内部规则|提示词)[^。！？\n]{0,12}(输出|打印|复述|回显|贴出|发给我|发我|给我|念)/i,
  },
  {
    id: 'prompt_verbatim_request',
    label: '要求逐字给出提示词/配置',
    pattern:
      /(完整|全文|原文|逐字|一字不差|一模一样)[^。！？\n]{0,12}(system\s*prompt|提示词|系统提示|内部指令|内部规则|配置项)/i,
  },
  {
    id: 'fake_system_tag',
    label: '伪造系统标记/对话分隔符',
    pattern:
      /<\/?(system|instruction|instructions|prompt|admin|sys)>|\[(\/?)(SYSTEM|INST|ADMIN)\]|<\|(im_start|im_end|system|endoftext)\|>/i,
  },
  {
    id: 'priority_override',
    label: '篡改指令优先级',
    pattern:
      /(以下|下面|后面|接下来|新增的?)[^。！？\n]{0,10}(指令|要求|规则|设定|命令)[^。！？\n]{0,12}(优先级|高于|覆盖|替代|取代|优先)/,
  },
  {
    id: 'discipline_disable',
    label: '要求停止遵守规则/纪律',
    pattern:
      /(不要|别|禁止|停止)[^。！？\n]{0,10}(遵守|执行|按|遵循)[^。！？\n]{0,12}(规则|纪律|限制|约束|要求|设定|系统提示)/,
  },
  {
    id: 'repeat_above_content',
    label: '要求原文回显上文内容',
    pattern:
      /(把|将)?[^。！？\n]{0,12}(上面|以上|前面|之前)[^。！？\n]{0,10}(所有|全部|内容|文字|指令|设定|提示)[^。！？\n]{0,10}(重复|复述|回显|输出|念出|打出来)/,
  },
  {
    id: 'secret_exfiltration',
    label: '索取密钥/环境变量/后台配置',
    pattern:
      /(api[_\s-]?key|apikey|密钥|令牌|token|环境变量|\.env|数据库地址|后台配置)[^。！？\n]{0,14}(给我|发我|输出|打印|是什么|内容|告诉我|贴出|发一下)/i,
  },
  {
    id: 'no_restriction_en',
    label: '宣称进入无限制状态（英文）',
    pattern:
      /you\s+are\s+now[^.\n]{0,40}(no\s+restrictions?|unfiltered|uncensored|without\s+(any\s+)?(limits?|restrictions?|filters?))/i,
  },
  {
    id: 'pretend_no_rules_en',
    label: '要求扮演不受规则约束的角色（英文）',
    pattern:
      /(pretend|imagine|act\s+as\s+if)[^.\n]{0,30}(you\s+(are|have)\s+no|not\s+bound\s+by|no\s+(rules|restrictions|limits))/i,
  },
];

/** 一次命中的结果：id/label 供日志与 trace 用，excerpt 供人工复核（已归一化、限长） */
export interface InjectionFinding {
  id: string;
  label: string;
  excerpt: string;
}

/** 摘录长度上限：够人工判断，又不会把整段输入写进日志 */
const EXCERPT_MAX = 60;

/**
 * 匹配前归一化：去零宽/不可见字符，全角 ASCII 转半角。
 *
 * 只处理「无代价的绕过手法」，不做同音字、拼音、拆字还原——那会滑向内容层审查，
 * 与本文件的设计前提冲突（见文件头）。
 */
export function normalizeForInjection(text: string): string {
  return text
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/** 扫描全部命中（供文档/演示展示「一句话命中几条特征」；服务端只关心第一条） */
export function scanInjection(text: string): InjectionFinding[] {
  if (!text) return [];
  const normalized = normalizeForInjection(text);
  const findings: InjectionFinding[] = [];
  for (const item of INJECTION_PATTERNS) {
    const match = item.pattern.exec(normalized);
    if (!match) continue;
    const start = Math.max(0, match.index - 8);
    findings.push({
      id: item.id,
      label: item.label,
      excerpt: normalized.slice(start, match.index + match[0].length + 8).slice(0, EXCERPT_MAX).trim(),
    });
  }
  return findings;
}

/** 取第一条命中（判定用）；未命中返回 null */
export function matchInjection(text: string): InjectionFinding | null {
  return scanInjection(text)[0] ?? null;
}
