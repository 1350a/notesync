/**
 * LLM Harness - 共享类型定义
 */
import type { ProviderMessage } from "@/lib/provider/types";

/** 诊断阶段：question=追问阶段（等待用户回答），answer=最终回答阶段（诊断正文） */
export type HarnessPhase = "question" | "answer";

export type { ProviderMessage };
