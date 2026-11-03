/*
 * =====================================================================
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：lib\agent\tools.ts
 * 说明：简易重构后无活跃引用、不再参与编译链路；此处逐行注释保留原文。
 * 恢复：git checkout -- lib/agent/tools.ts（如已提交），或删除各行前缀 "// "。
 * =====================================================================
 */
// /**
//  * Agent 层 - 工具实现
//  *
//  * 三个工具均以 RAG 知识库为底座，返回证据化结果（带来源标题），
//  * 模型据此生成诊断，避免凭空发挥。
//  */
// import { searchKnowledge, searchAll, formatHits, listSubjects } from "@/lib/rag/store";
// import type { AgentToolDef, AgentToolName } from "./types";
// 
// /** 工具定义（注入系统提示词） */
// export const AGENT_TOOLS: AgentToolDef[] = [
//   {
//     name: "query_knowledge",
//     description: "检索知识库中的知识点卡片，获得概念、公式、易错点等权威资料。",
//     parameters: '{"query": "检索关键词，如：一元二次方程判别式", "subject": "学科（可选，如：数学）"}',
//   },
//   {
//     name: "find_similar_problems",
//     description: "在典型错题案例库中查找与当前题目相似的错题及错因分类，用于对照诊断。",
//     parameters: '{"description": "对当前错题的简要描述，如：解方程时符号搞错"}',
//   },
//   {
//     name: "generate_review_plan",
//     description: "基于诊断出的薄弱点生成个性化复习计划（含知识点回顾与练习建议）。",
//     parameters: '{"weaknesses": ["薄弱点1", "薄弱点2"], "subjects": ["学科（可选）"]}',
//   },
// ];
// 
// /** 工具名合法性校验 */
// function isToolName(name: string): name is AgentToolName {
//   return AGENT_TOOLS.some((t) => t.name === name);
// }
// 
// /** 归一化工具名（容忍模型输出中文或带下划线变体） */
// export function normalizeToolName(name: string): AgentToolName | null {
//   if (isToolName(name)) return name;
//   const map: Record<string, AgentToolName> = {
//     query_knowledge: "query_knowledge",
//     queryknowledge: "query_knowledge",
//     search_knowledge: "query_knowledge",
//     find_similar_problems: "find_similar_problems",
//     findsimilarproblems: "find_similar_problems",
//     similar_problems: "find_similar_problems",
//     generate_review_plan: "generate_review_plan",
//     generatereviewplan: "generate_review_plan",
//     review_plan: "generate_review_plan",
//   };
//   return map[name] ?? null;
// }
// 
// /** 工具执行入口：返回文本结果（回填模型上下文） */
// export async function runTool(
//   name: string,
//   args: Record<string, unknown>
// ): Promise<{ ok: boolean; text: string; sources: string[] }> {
//   const toolName = normalizeToolName(name);
//   if (!toolName) {
//     return {
//       ok: false,
//       text: `未知工具：${name}。可用工具：${AGENT_TOOLS.map((t) => t.name).join("、")}。`,
//       sources: [],
//     };
//   }
// 
//   const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
// 
//   switch (toolName) {
//     case "query_knowledge": {
//       const query = str(args.query);
//       if (!query) return { ok: false, text: "参数缺少 query（检索关键词）。", sources: [] };
//       const subject = str(args.subject) || undefined;
//       const result = await searchKnowledge(query, { kind: "knowledge", subject, topK: 4 });
//       const sources = result.hits.map((h) => h.chunk.title);
//       return { ok: true, text: formatHits(result), sources };
//     }
//     case "find_similar_problems": {
//       const description = str(args.description);
//       if (!description) return { ok: false, text: "参数缺少 description（错题简要描述）。", sources: [] };
//       const result = await searchAll(description, { kind: "mistake", topK: 3 });
//       const sources = result.hits.map((h) => h.chunk.title);
//       return { ok: true, text: formatHits(result), sources };
//     }
//     case "generate_review_plan": {
//       const rawWeak = args.weaknesses;
//       const weaknesses = Array.isArray(rawWeak)
//         ? rawWeak.filter((w): w is string => typeof w === "string" && Boolean(w.trim()))
//         : typeof rawWeak === "string"
//           ? rawWeak.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean)
//           : [];
//       if (weaknesses.length === 0) {
//         return { ok: false, text: "参数缺少 weaknesses（薄弱点列表）。", sources: [] };
//       }
//       const subjects = await listSubjects();
//       const plan = [
//         "复习计划（基于诊断出的薄弱点）：",
//         ...weaknesses.map((w, i) => `${i + 1}. 重点回顾：${w}；每天 15 分钟专项练习，连续 3 天。`),
//         "2. 通用建议：建立错题本，按错因分类（概念不清/方法缺失/计算失误/审题偏差/粗心）记录。",
//         "3. 每完成一个薄弱点，做 1 套同类型综合题自测，正确率≥90% 再进入下一项。",
//         `可覆盖学科：${subjects.join("、") || "数学"}。`,
//       ].join("\n");
//       return { ok: true, text: plan, sources: [] };
//     }
//   }
// }
// 
// /** 构造工具定义文本（注入系统提示词） */
// export function toolDescriptions(): string {
//   return AGENT_TOOLS.map(
//     (t) => `- ${t.name}：${t.description}\n  参数：${t.parameters}`
//   ).join("\n");
// }
// 
