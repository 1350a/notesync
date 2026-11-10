/*
 * 本地嵌入公开入口
 *
 * 协议见 doc/browser-local-inference.md §4：
 * - 批量嵌入 + L2 归一化（池化=cls、normalize=true，均由 pipeline 内完成）；
 * - 调用方无需管理引擎生命周期：未就绪时自动初始化（无进度回调；
 *   需要展示下载进度的场景先自行 initLocalEngine(onProgress)）。
 */
import { engineEmbed, initLocalEngine, getLocalEngineStatus } from "./engine";

/** bge-small-zh-v1.5 输出维度（config.json max_position/hidden 一致性由模型保证） */
export const EMBED_DIM = 512;

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  if (getLocalEngineStatus().state !== "ready") {
    const status = await initLocalEngine();
    if (status.state !== "ready") {
      throw new Error(
        `本地推理引擎初始化失败：${status.state === "error" ? status.message : status.state}`,
      );
    }
  }
  return engineEmbed(texts);
}
