/**
 * /api/chat 的 MOCK 仿真剧本（从路由抽出，只搬不改）。
 *
 * MOCK_MODEL=1 时不调用任何上游，只回显实际组装出来的发送结构，并让诊断卡片、
 * 掌握度回路、ask_user 中断与状态机推进在零 token 下完整走通（UI 验证 / 演示彩排用，
 * 不依赖任何 API key）。所有内容显式标注「MOCK 仿真」，与真实模型输出不可混淆
 * （AGENTS.md §8）。
 *
 * 抽出的原因：这段剧本此前和真实推理链路挤在同一个 700 行路由里，改真实链路时
 * 容易误碰仿真数据，读路由也难以分辨哪些代码只在 MOCK 下生效。
 */
import { buildProviderMessages, type ChatRequestBody } from '@/lib/chat/messages';
import { assembleDiagnoseMessage, resolveAssembleImageMode } from '@/lib/diagnose/assemble';
import { buildDiagnoseSystemPrompt } from '@/lib/diagnose/prompts';
import { findStrategyCard, STRATEGY_VERSION } from '@/lib/diagnose/strategies';
import { transition } from '@/lib/diagnose/state-machine';
import { buildVerifyEvidence, resolveDiagnoseSession } from '@/lib/diagnose/runtime';
import type {
  DiagnoseAttachment,
  DiagnoseContext,
  DiagnosisResult,
} from '@/lib/diagnose/types';
import type { AskUserQuestion } from '@/lib/tools/types';
import type { ProviderMessage } from '@/lib/provider/types';
import { encoder, sse, SSE_HEADERS } from '@/lib/sse';

/** 把组装结果渲染成可读摘要（MOCK 专用，不回显 base64 本体） */
function summarizeForMock(result: ReturnType<typeof assembleDiagnoseMessage>): string {
  const content = result.message?.content;
  const parts = Array.isArray(content) ? content : [];
  const rows = parts.map((part, index) => {
    if (part.type === 'text') {
      const preview = part.text.replace(/\s+/g, ' ').slice(0, 48);
      return `| ${index + 1} | text | ${part.text.length} | ${preview} |`;
    }
    const url = part.image_url.url;
    const head = url.slice(0, 24);
    return `| ${index + 1} | image_url | ${url.length} | ${head}… |`;
  });

  const lines = [
    '> MOCK 模式：未调用任何模型，以下为实际组装出来的发送结构。',
    '',
    `- 消息条数：1（role=user）`,
    `- part 数：${parts.length}（图片 ${result.stats.images} / 文本 ${result.stats.texts}）`,
    `- 文本字符数：${result.stats.chars}`,
    '',
    '| # | 类型 | 长度 | 预览 |',
    '| --- | --- | --- | --- |',
    ...rows,
  ];

  if (result.warnings.length > 0) {
    lines.push('', '**降级与告警**', ...result.warnings.map((w) => `- ${w}`));
  }
  return lines.join('\n');
}

/** MOCK 模式下的聊天消息摘要：只回显每条消息的内容形态，不回显 base64 本体 */
function summarizeChatMessages(messages: ProviderMessage[]): string {
  const rows = messages.map((m, index) => {
    if (typeof m.content === 'string') {
      const preview = m.content.replace(/\s+/g, ' ').slice(0, 48);
      return `| ${index + 1} | ${m.role} | text | ${m.content.length} | ${preview} |`;
    }
    const images = m.content.filter((part) => part.type === 'image_url').length;
    const texts = m.content.length - images;
    const preview = m.content
      .filter((part) => part.type === 'text')
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 32);
    return `| ${index + 1} | ${m.role} | 多模态（图片 ${images} / 文本 ${texts}） | - | ${preview} |`;
  });
  return [
    '> MOCK 模式：未调用任何模型，以下为 messages 实际组装结构。',
    '',
    '| # | 角色 | 内容形态 | 字符数 | 预览 |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/**
 * MOCK 诊断仿真剧本：按当前状态给出一轮固定输出，让诊断卡片、掌握度回路、ask_user 中断
 * 与状态机推进在零 token 下完整走通（UI 验证/演示彩排用，不依赖任何 API key）。
 * 所有内容显式标注「MOCK 仿真」，与真实模型输出不可混淆（AGENTS.md §8）。
 */
function mockDiagnosisScript(
  session: NonNullable<ReturnType<typeof resolveDiagnoseSession>>,
  hasAttachments: boolean,
): {
  content: string;
  diagnosis?: DiagnosisResult;
  awaitingQuestions?: AskUserQuestion[];
  nextContext: DiagnoseContext;
} {
  const { context, completeness } = session;
  // 聊天链路下 MOCK 扮演「模型判定」：有题无作答；附件链路沿用真实推导
  const simulatedCompleteness = hasAttachments
    ? completeness
    : { ...completeness, hasProblem: true, hasStudentAnswer: context.state !== 'intake' };
  const tag = '（MOCK 仿真）';

  switch (context.state) {
    case 'intake': {
      const diagnosis: DiagnosisResult = {
        subject: 'math',
        level: 'L1',
        completeness: simulatedCompleteness,
        knowledgePoints: ['一元二次方程', '判别式与求根公式'],
        errorCause: null,
        strategy: null,
        hints: [{ level: 1, content: `${tag}这题考判别式符号与求根公式的适用。` }],
        notes: simulatedCompleteness.hasStudentAnswer
          ? undefined
          : '未提供作答，本次不做错因归因。',
        strategyVersion: STRATEGY_VERSION,
      };
      const next = transition(context, { type: 'intake_done', hasProblem: true, isMath: true })
        .context;
      const nextContext = simulatedCompleteness.hasStudentAnswer
        ? transition(next, { type: 'clarify_done', hasAnswer: true, refused: false }).context
        : next;
      return {
        content: `${tag}L1 题目画像：考点是判别式与求根公式；常见错法见下方卡片（固定剧本，仅验证链路）。`,
        diagnosis,
        nextContext,
      };
    }
    case 'clarify':
      return {
        content: '',
        awaitingQuestions: [
          {
            label: 'MOCK 补问',
            question: `${tag}这道题常见的错法是 A. 公式记错 B. 计算失误 C. 隐含条件遗漏，你是哪一种，还是都不确定？`,
            options: ['A. 公式记错', 'B. 计算失误', 'C. 隐含条件遗漏', '都不确定'],
          },
        ],
        nextContext: context,
      };
    case 'diagnose': {
      const diagnosis: DiagnosisResult = {
        subject: 'math',
        level: 'L2',
        completeness: simulatedCompleteness,
        knowledgePoints: ['判别式与求根公式'],
        errorCause: { code: 'formula_misuse', confidence: 0.82 },
        secondaryErrorCause: { code: 'calc_error', confidence: 0.31 },
        strategy: findStrategyCard('formula_misuse'),
        hints: [{ level: 1, content: `${tag}先确认判别式公式本身的符号。` }],
        notes: '（MOCK 仿真数据，用于验证卡片与回路渲染）',
        strategyVersion: STRATEGY_VERSION,
      };
      return {
        content: `${tag}你写的 Δ = b² + 4ac 这步存在公式误用——判别式应为 b² − 4ac（固定剧本，仅验证链路）。`,
        diagnosis,
        nextContext: transition(context, { type: 'diagnosis_done', outcome: 'confident' }).context,
      };
    }
    case 'explain': {
      const levelText: Record<1 | 2 | 3, string> = {
        1: '定位：这题考判别式符号与求根公式。',
        2: '方向：先核对公式再代数计算。',
        3: '关键步骤：Δ = b² − 4ac 的展开与符号。',
      };
      return {
        content: `${tag}提示阶梯第 ${context.hintLevel} 级——${levelText[context.hintLevel]}`,
        nextContext: context,
      };
    }
    case 'L1_only':
      return {
        content: `${tag}L1 题目画像 + 声明：未能进行错因归因。`,
        diagnosis: {
          subject: 'math',
          level: 'L1',
          completeness: simulatedCompleteness,
          knowledgePoints: ['一元二次方程'],
          errorCause: null,
          strategy: null,
          hints: [],
          notes: '未能定位具体断点，本次不做错因归因。',
          strategyVersion: STRATEGY_VERSION,
        },
        nextContext: transition(context, { type: 'output_done' }).context,
      };
    case 'reject':
      return {
        content: `${tag}本系统当前仅支持数学错题诊断。`,
        nextContext: transition(context, { type: 'output_done' }).context,
      };
    case 'done':
      return { content: `${tag}收尾：有新的错题随时发来。`, nextContext: context };
  }
}

/** MOCK 响应流：不解析模型，直接回显组装摘要 */
export function mockStream(
  attachments: DiagnoseAttachment[],
  body: ChatRequestBody
): Response {
  const assembled = assembleDiagnoseMessage(attachments, {
    imageMode:
      process.env.MOCK_IMAGE_MODE === 'text-only'
        ? 'text-only'
        : resolveAssembleImageMode(attachments, true),
  });
  const { messages: chatMessages } = buildProviderMessages(body);
  const hasChatContent = chatMessages.some((m) =>
    typeof m.content === 'string' ? m.content.trim().length > 0 : m.content.length > 0
  );

  // 诊断模式零 token 摘要：回显状态机上下文、完整度与注入的系统提示词规模
  const diagnoseSession = resolveDiagnoseSession(body.diagnose, attachments);
  const diagnoseBlock = diagnoseSession
    ? [
        '',
        '**诊断模式（MOCK 摘要）**',
        `- 状态机: ${diagnoseSession.context.state}（追问已用 ${diagnoseSession.context.clarifyUsed} 次，阶梯 L${diagnoseSession.context.hintLevel}）`,
        `- 完整度: ${JSON.stringify(diagnoseSession.completeness)}${
          attachments.length > 0
            ? '（来源：四类附件推导）'
            : '（来源：四类附件推导；本请求无附件，聊天页输入的完整度由模型在 intake 判定，MOCK 下不跑模型故全 false）'
        }`,
        `- 机械判定证据: ${buildVerifyEvidence(attachments) || '（无，缺少成对的 wrong/correct 文本）'}`,
        `- 分状态系统提示词: ${
          buildDiagnoseSystemPrompt({
            state: diagnoseSession.context.state,
            ctx: diagnoseSession.context,
            completeness: diagnoseSession.completeness,
            verifyEvidence: buildVerifyEvidence(attachments),
          })?.length ?? 0
        } 字符`,
      ].join('\n')
    : '';

  // 诊断模式仿真剧本：让卡片/回路/状态推进在 MOCK 下可完整走通（零 token UI 验证）
  const script = diagnoseSession
    ? mockDiagnosisScript(diagnoseSession, attachments.length > 0)
    : null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 纯聊天请求（无诊断附件）：回显 messages 组装结构，便于零 token 校验图片是否真的进了请求
      if (attachments.length === 0) {
        if (!hasChatContent) {
          controller.enqueue(
            encoder.encode(
              sse('error', { code: 'no_content', error: '请求里没有可发送的内容。' })
            )
          );
          controller.close();
          return;
        }
        controller.enqueue(
          encoder.encode(sse('content', { delta: summarizeChatMessages(chatMessages) + diagnoseBlock }))
        );
        if (script) {
          if (script.content) {
            controller.enqueue(
              encoder.encode(sse('content', { delta: `\n\n---\n\n${script.content}` }))
            );
          }
          if (script.diagnosis) {
            controller.enqueue(encoder.encode(sse('diagnosis', { result: script.diagnosis })));
          }
          if (script.awaitingQuestions) {
            controller.enqueue(
              encoder.encode(
                sse('awaiting_user', {
                  questions: script.awaitingQuestions,
                  toolCallId: 'mock-ask-user',
                })
              )
            );
          }
        }
        controller.enqueue(
          encoder.encode(
            sse('done', {
              model: 'mock',
              provider: 'mock',
              usedRounds: 0,
              finishReason: script?.awaitingQuestions ? 'awaiting_user' : 'mock',
              ...(script ? { diagnose: { context: script.nextContext } } : {}),
            })
          )
        );
        controller.close();
        return;
      }
      if (!assembled.message) {
        controller.enqueue(
          encoder.encode(
            sse('error', {
              code: 'no_content',
              error: '上传的文件未提取到可用内容，请检查后重新上传。',
            })
          )
        );
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(sse('content', { delta: summarizeForMock(assembled) + diagnoseBlock }))
      );
      if (script) {
        if (script.content) {
          controller.enqueue(
            encoder.encode(sse('content', { delta: `\n\n---\n\n${script.content}` }))
          );
        }
        if (script.diagnosis) {
          controller.enqueue(encoder.encode(sse('diagnosis', { result: script.diagnosis })));
        }
        if (script.awaitingQuestions) {
          controller.enqueue(
            encoder.encode(
              sse('awaiting_user', {
                questions: script.awaitingQuestions,
                toolCallId: 'mock-ask-user',
              })
            )
          );
        }
      }
      controller.enqueue(
        encoder.encode(
          sse('done', {
            model: 'mock',
            provider: 'mock',
            usedRounds: 0,
            finishReason: script?.awaitingQuestions ? 'awaiting_user' : 'mock',
            ...(script ? { diagnose: { context: script.nextContext } } : {}),
          })
        )
      );
      controller.close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
