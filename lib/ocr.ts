/*
 * =====================================================================
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：lib\ocr.ts
 * 说明：简易重构后无活跃引用、不再参与编译链路；此处逐行注释保留原文。
 * 恢复：git checkout -- lib/ocr.ts（如已提交），或删除各行前缀 "// "。
 * =====================================================================
 */
// /**
//  * OCR 兜底识别（tesseract.js）
//  *
//  * 用于纯文本模型（ollama 等）无法直接"看见"图片的场景：
//  * 服务端对上传的错题图片做 OCR，把识别文字注入对话上下文，模型即可基于
//  * 题目文字继续诊断，不再因"看不到图"而误判信息不足、反复追问。
//  *
//  * 设计：
//  * - 单例 worker 惰性初始化（本地 core + tessdata 语言包，首次初始化后复用）
//  * - 超时控制：单次识别超时返回空串，不阻塞诊断主流程
//  * - 结果缓存：同一 dataUrl 只识别一次（会话生命周期内）
//  * - 大小限制：超过阈值跳过（与 harness MAX_IMAGE_DATA_URL 对齐）
//  *
//  * 本地化说明：
//  * - langPath 指向项目 tessdata/ 目录（chi_sim.traineddata.gz 随仓库分发，离线可用）
//  * - corePath 指向 node_modules/tesseract.js-core（Next 通过 serverExternalPackages 外部化，
//  *   运行时直接 require，不经打包器）
//  * - 语言仅用 chi_sim：tesseract.js v7 对 "chi_sim+eng" 多语言在自定义 langPath 下
//  *   存在加载乱码 bug（Failed loading language），单语言稳定
//  */
// import { createWorker } from "tesseract.js";
// import type { Worker } from "tesseract.js";
// import path from "node:path";
// 
// /** 单张图片 dataUrl 上限（base64 字符串长度，约 9MB 原图），超过则跳过 OCR */
// const MAX_OCR_DATA_URL = 12 * 1024 * 1024;
// /** 单次识别超时（ms）：OCR 极慢时降级为"未识别到" */
// const OCR_TIMEOUT = 30_000;
// /** 结果缓存条数上限（防内存膨胀） */
// const CACHE_LIMIT = 50;
// 
// let workerPromise: Promise<Worker> | null = null;
// /** dataUrl -> 识别文本（含空结果，避免失败图反复重试） */
// const ocrCache = new Map<string, string>();
// 
// /** 惰性获取 OCR worker；初始化失败后置空，允许下次调用重试 */
// function getWorker(): Promise<Worker> {
//   if (!workerPromise) {
//     const tessdataDir = path.join(process.cwd(), "tessdata");
//     const coreDir = path.join(process.cwd(), "node_modules", "tesseract.js-core");
//     workerPromise = createWorker("chi_sim", 1, {
//       logger: () => {},
//       langPath: tessdataDir,
//       corePath: coreDir,
//     }).catch((err) => {
//       workerPromise = null;
//       throw err;
//     });
//   }
//   return workerPromise;
// }
// 
// /**
//  * 对图片 dataUrl 做 OCR，返回识别文本（空白归一化）。
//  * 无文字 / 识别失败 / 超时 / 超过大小限制 时返回空字符串。
//  */
// export async function extractImageText(dataUrl: string): Promise<string> {
//   if (!dataUrl || dataUrl.length > MAX_OCR_DATA_URL) return "";
//   const cached = ocrCache.get(dataUrl);
//   if (cached !== undefined) return cached;
// 
//   const worker = await getWorker().catch(() => null);
//   if (!worker) return "";
// 
//   const result = await Promise.race([
//     worker
//       .recognize(dataUrl)
//       .then(({ data }) => (data.text ?? "").replace(/\s+/g, " ").trim()),
//     new Promise<string>((resolve) => setTimeout(() => resolve(""), OCR_TIMEOUT)),
//   ]).catch(() => "");
// 
//   ocrCache.set(dataUrl, result);
//   if (ocrCache.size > CACHE_LIMIT) {
//     const oldestKey = ocrCache.keys().next().value;
//     if (oldestKey) ocrCache.delete(oldestKey);
//   }
//   return result;
// }
// 
