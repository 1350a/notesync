/*
 * =====================================================================
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：lib\agent\loop.ts
 * 说明：简易重构后无活跃引用、不再参与编译链路；此处逐行注释保留原文。
 * 恢复：git checkout -- lib/agent/loop.ts（如已提交），或删除各行前缀 "// "。
 * =====================================================================
 */
// /**
//  * Agent 层 - 决策循环
//  *
//  * 流程：
//  * 1. 向模型发送带决策协议的提示，获取 JSON 决策（action=tools/question/answer）
//  * 2. action=tools → 执行工具 → 结果回填上下文 → 回到 1（最多 MAX_TOOL_ROUNDS 轮）
//  * 3. action=question → 返回追问列表（最终由 harness 输出）
//  * 4. action=answer → 返回决策（正文由 harness 另行流式生成）
//  */
// import type { LLMProvider, ProviderMessage } from "@/lib/provider/types";
// import { runTool } from "./tools";
// import type { AgentDecision, AgentToolCall, ThinkingStep } from "./types";
// 
// /** 工具调用最大轮数 */
// export const MAX_TOOL_ROUNDS = 3;
// /** 单条工具结果回填的最大字符数 */
// const TOOL_RESULT_LIMIT = 2000;
// 
// /** 从模型输出中提取 JSON 对象（容忍 ```json 包裹与前后杂讯） */
// export function extractJsonObject<T>(raw: string): T | null {
//   if (!raw) return null;
//   // 去掉 ```json / ``` 围栏
//   let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
//   // 尝试整体解析
//   try {
//     return JSON.parse(text) as T;
//   } catch {
//     // 忽略
//   }
//   // 提取第一个 { ... } 平衡块
//   const start = text.indexOf("{");
//   if (start >= 0) {
//     let depth = 0;
//     let inString = false;
//     let escape = false;
//     for (let i = start; i < text.length; i++) {
//       const ch = text[i];
//       if (escape) {
//         escape = false;
//         continue;
//       }
//       if (ch === "\\") {
//         escape = true;
//         continue;
//       }
//       if (ch === '"') {
//         inString = !inString;
//         continue;
//       }
//       if (inString) continue;
//       if (ch === "{") depth++;
//       else if (ch === "}") {
//         depth--;
//         if (depth === 0) {
//           try {
//             return JSON.parse(text.slice(start, i + 1)) as T;
//           } catch {
//             return null;
//           }
//         }
//       }
//     }
//   }
//   return null;
// }
// 
// /** 决策 JSON 字段提取与归一化 */
// export function parseDecision(raw: string): AgentDecision | null {
//   const obj = extractJsonObject<Record<string, unknown>>(raw);
//   if (!obj) return null;
//   const action = obj.action;
//   if (action !== "tools" && action !== "question" && action !== "answer") return null;
// 
//   const decision: AgentDecision = { action };
// 
//   if (Array.isArray(obj.questions)) {
//     decision.questions = obj.questions
//       .filter((q): q is string => typeof q === "string" && Boolean(q.trim()))
//       .slice(0, 5);
//   }
// 
//   if (typeof obj.image_summary === "string" && obj.image_summary.trim()) {
//     decision.image_summary = obj.image_summary.trim().slice(0, 400);
//   }
// 
//   if (typeof obj.plan === "string" && obj.plan.trim()) {
//     decision.plan = obj.plan.trim();
//   }
// 
//   if (Array.isArray(obj.tool_calls)) {
//     const calls: AgentToolCall[] = [];
//     for (const rawCall of obj.tool_calls.slice(0, 3)) {
//       if (!rawCall || typeof rawCall !== "object") continue;
//       const name = (rawCall as { name?: unknown }).name;
//       const args = (rawCall as { arguments?: unknown }).arguments;
//       if (typeof name === "string" && args && typeof args === "object") {
//         calls.push({
//           name: name as AgentToolCall["name"],
//           arguments: args as Record<string, unknown>,
//         });
//       }
//     }
//     if (calls.length > 0) decision.tool_calls = calls;
//   }
// 
//   return decision;
// }
// 
// /** 截断文本 */
// function truncate(text: string, max: number): string {
//   if (text.length <= max) return text;
//   return `${text.slice(0, max)}…（已截断）`;
// }
// 
// /** Agent 决策循环 */
// export async function runAgentLoop(options: {
//   model: string;
//   provider: LLMProvider;
//   messages: ProviderMessage[];
//   signal?: AbortSignal;
// }): Promise<{ decision: AgentDecision; thinking: ThinkingStep[]; finalMessages: ProviderMessage[] }> {
//   const { model, provider, signal } = options;
//   const messages = [...options.messages];
//   const thinking: ThinkingStep[] = [];
//   let decision: AgentDecision | null = null;
// 
//   for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
//     const raw = await provider.complete({ model, messages, json: true, signal });
//     decision = parseDecision(raw);
//     if (!decision) {
//       // 模型未按协议输出：记录并强制走 answer（正文由 harness 流式生成）
//       thinking.push({ type: "status", message: "模型输出格式异常，已切换为直接诊断模式" });
//       decision = { action: "answer", plan: raw.slice(0, 200) };
//       break;
//     }
// 
//     if (decision.action === "tools" && decision.tool_calls && decision.tool_calls.length > 0) {
//       const calls = decision.tool_calls;
//       const callDesc = calls.map((c) => `${c.name}(${JSON.stringify(c.arguments)})`).join("、");
//       thinking.push({ type: "status", message: `正在检索资料：${callDesc}` });
// 
//       for (const call of calls) {
//         const result = await runTool(call.name, call.arguments);
//         thinking.push({
//           type: result.ok ? "tool" : "status",
//           message: result.ok
//             ? `工具 ${call.name} 执行完成，命中 ${result.sources.length} 条资料`
//             : `工具 ${call.name} 执行失败：${result.text}`,
//           tool: call.name,
//           args: call.arguments,
//           result: truncate(result.text, 400),
//           ...(result.ok && result.sources.length > 0 ? { sources: result.sources } : {}),
//         });
//         messages.push({
//           role: "assistant",
//           content: `[工具调用] ${call.name}(${JSON.stringify(call.arguments)})`,
//         });
//         messages.push({
//           role: "user",
//           content: `[工具结果] ${truncate(result.text, TOOL_RESULT_LIMIT)}`,
//         });
//       }
//       // 工具轮后继续循环让模型基于结果决策
//       continue;
//     }
// 
//     // question / answer：结束循环
//     break;
//   }
// 
//   if (!decision) {
//     decision = { action: "answer" };
//   }
//   return { decision, thinking, finalMessages: messages };
// }
// 
