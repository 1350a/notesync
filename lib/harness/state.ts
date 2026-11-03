/*
 * =====================================================================
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：lib\harness\state.ts
 * 说明：简易重构后无活跃引用、不再参与编译链路；此处逐行注释保留原文。
 * 恢复：git checkout -- lib/harness/state.ts（如已提交），或删除各行前缀 "// "。
 * =====================================================================
 */
// /**
//  * harness 层 - 信息收集状态机
//  *
//  * 解决"追问死循环"缺陷：
//  * - 服务端从历史推导已追问轮数，达到上限后强制进入诊断
//  * - 服务端启发式汇总已收集信息，注入提示词让模型明确当前进度
//  * - 图片跨轮记忆：图片在首轮由模型生成 imageSummary，后续轮次引用摘要而非重传图片
//  */
// import type { ProviderMessage } from "@/lib/provider/types";
// 
// /** 单轮诊断允许的最大追问轮数 */
// export const MAX_ASKS = 3;
// 
// /** 从消息历史推导已追问轮数（assistant 且 phase=question 的消息） */
// export function deriveAskCount(
//   messages: { role: string; phase?: string }[]
// ): number {
//   return messages.filter(
//     (m) => m.role === "assistant" && m.phase === "question"
//   ).length;
// }
// 
// /** 启发式判定是否已收集某类信息 */
// export interface CollectedFacts {
//   /** 有题目内容（文字或附件） */
//   hasContent: boolean;
//   /** 有图片/PDF 附件 */
//   hasAttachment: boolean;
//   /** 有错因/卡点描述 */
//   hasMistakeDesc: boolean;
//   /** 有解题过程/步骤 */
//   hasSolutionProcess: boolean;
//   /** 有知识背景（章节/概念） */
//   hasContext: boolean;
// }
// 
// /** 从用户消息中提取已收集信息（简单启发式） */
// export function deriveCollectedFacts(
//   messages: { role: string; content?: string; attachments?: unknown[] }[]
// ): CollectedFacts {
//   let hasContent = false;
//   let hasAttachment = false;
//   let hasMistakeDesc = false;
//   let hasSolutionProcess = false;
//   let hasContext = false;
// 
//   for (const m of messages) {
//     if (m.role !== "user") continue;
//     const content = m.content ?? "";
//     if (content.trim()) hasContent = true;
//     if (Array.isArray(m.attachments) && m.attachments.length > 0) hasAttachment = true;
//     if (/错|错因|错误|不懂|不会|卡|失误|粗心/.test(content)) hasMistakeDesc = true;
//     if (/解|步骤|过程|算|写|做|思路/.test(content)) hasSolutionProcess = true;
//     if (/知识|概念|公式|定理|章节|课本|教材/.test(content)) hasContext = true;
//   }
// 
//   return { hasContent, hasAttachment, hasMistakeDesc, hasSolutionProcess, hasContext };
// }
// 
// /** 生成状态块文本（注入系统提示词，让模型明确进度） */
// export function buildStateBlock(
//   messages: { role: string; content?: string; phase?: string; attachments?: unknown[] }[]
// ): string {
//   const askCount = deriveAskCount(messages);
//   const facts = deriveCollectedFacts(messages);
// 
//   const collected: string[] = [];
//   if (facts.hasContent) collected.push("题目内容");
//   if (facts.hasAttachment) collected.push("图片/PDF 附件");
//   if (facts.hasMistakeDesc) collected.push("错因/卡点描述");
//   if (facts.hasSolutionProcess) collected.push("解题过程");
//   if (facts.hasContext) collected.push("知识背景");
// 
//   const remaining: string[] = [];
//   if (!facts.hasContent) remaining.push("题目内容");
//   if (!facts.hasMistakeDesc) remaining.push("错因/卡点描述");
//   if (!facts.hasSolutionProcess) remaining.push("解题过程");
//   if (!facts.hasContext) remaining.push("知识背景");
// 
//   const exhausted = askCount >= MAX_ASKS;
// 
//   return [
//     "【当前信息收集状态（服务端统计）】",
//     `已追问轮数：${askCount} / ${MAX_ASKS}${exhausted ? "（已达上限）" : ""}`,
//     `已收集信息：${collected.length > 0 ? collected.join("、") : "（无）"}`,
//     `待补充信息：${remaining.length > 0 ? remaining.join("、") : "（基本完备）"}`,
//     exhausted
//       ? "【强制约束】已追问达到上限，本次必须选择 action=answer 直接给出诊断，禁止再输出问题。"
//       : "【提示】优先只追问最关键的 1-3 个缺失信息；能诊断就不要追问。",
//   ].join("\n");
// }
// 
