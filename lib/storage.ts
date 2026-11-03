/*
 * =====================================================================
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：lib\storage.ts
 * 说明：简易重构后无活跃引用、不再参与编译链路；此处逐行注释保留原文。
 * 恢复：git checkout -- lib/storage.ts（如已提交），或删除各行前缀 "// "。
 * =====================================================================
 */
// /**
//  * 错题认知诊断引擎 - localStorage 会话持久化工具
//  * 支持多个会话（对话分支）的新建、切换、删除，刷新不丢失。
//  */
// import type { Conversation, Message } from "./types";
// 
// /** localStorage 存储键 */
// const STORAGE_KEY = "mistake-diagnosis-conversations";
// /** 默认模型（简易重构版：不再使用 ollama 本地模型，改为云端三选一默认模型） */
// export const DEFAULT_MODEL = "deepseek-v4-flash";
// 
// /** 生成短 ID */
// export function genId(): string {
//   return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// }
// 
// /** 清理旧版 bug 残留的脏消息：同 id 去重（保留后出现者），丢弃无内容的空 AI 消息 */
// function cleanMessages(messages: Message[]): Message[] {
//   const byId = new Map<string, Message>();
//   for (const m of messages) {
//     byId.set(m.id, m); // 后出现者覆盖先出现者
//   }
//   return Array.from(byId.values()).filter(
//     (m) =>
//       !(
//         m.role === "assistant" &&
//         !m.content.trim() &&
//         (!m.questions || m.questions.length === 0) &&
//         (!m.thinking || m.thinking.length === 0)
//       )
//   );
// }
// 
// /** 读取全部会话（按更新时间倒序） */
// export function loadConversations(): Conversation[] {
//   if (typeof window === "undefined") return [];
//   try {
//     const raw = window.localStorage.getItem(STORAGE_KEY);
//     if (!raw) return [];
//     const parsed = JSON.parse(raw) as Conversation[];
//     if (!Array.isArray(parsed)) return [];
//     return parsed
//       .map((c) => ({ ...c, messages: cleanMessages(c.messages ?? []) }))
//       .sort((a, b) => b.updatedAt - a.updatedAt);
//   } catch {
//     return [];
//   }
// }
// 
// /** 持久化全部会话 */
// export function saveConversations(conversations: Conversation[]): void {
//   if (typeof window === "undefined") return;
//   try {
//     window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
//   } catch {
//     // 存储满等异常静默失败，避免影响聊天
//   }
// }
// 
// /** 新建会话 */
// export function createConversation(
//   title: string,
//   model: string = DEFAULT_MODEL
// ): Conversation {
//   const now = Date.now();
//   const conversation: Conversation = {
//     id: genId(),
//     title: title || "新会话",
//     messages: [],
//     model,
//     createdAt: now,
//     updatedAt: now,
//   };
//   const all = loadConversations();
//   all.unshift(conversation);
//   saveConversations(all);
//   return conversation;
// }
// 
// /** 更新会话（标题/消息/模型），自动刷新 updatedAt */
// export function updateConversation(
//   id: string,
//   patch: Partial<Pick<Conversation, "title" | "messages" | "model">>
// ): Conversation | null {
//   const all = loadConversations();
//   const idx = all.findIndex((c) => c.id === id);
//   if (idx < 0) return null;
//   const next: Conversation = {
//     ...all[idx],
//     ...patch,
//     updatedAt: Date.now(),
//   };
//   all[idx] = next;
//   saveConversations(all);
//   return next;
// }
// 
// /** 删除会话 */
// export function deleteConversation(id: string): void {
//   const all = loadConversations().filter((c) => c.id !== id);
//   saveConversations(all);
// }
// 
// /** 追加消息到会话 */
// export function appendMessage(id: string, message: Message): Conversation | null {
//   const all = loadConversations();
//   const idx = all.findIndex((c) => c.id === id);
//   if (idx < 0) return null;
//   const next: Conversation = {
//     ...all[idx],
//     messages: [...all[idx].messages, message],
//     updatedAt: Date.now(),
//   };
//   all[idx] = next;
//   saveConversations(all);
//   return next;
// }
// 
// /** 从消息内容生成会话标题（截断 20 字） */
// export function makeTitle(content: string): string {
//   const trimmed = content.replace(/\s+/g, " ").trim();
//   if (!trimmed) return "新会话";
//   return trimmed.length > 20 ? `${trimmed.slice(0, 20)}…` : trimmed;
// }
// 
