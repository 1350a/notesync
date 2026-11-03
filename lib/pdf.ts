/*
 * =====================================================================
 * 【已注释停用 - 保留原文便于恢复】
 * 原文件：lib\pdf.ts
 * 说明：简易重构后无活跃引用、不再参与编译链路；此处逐行注释保留原文。
 * 恢复：git checkout -- lib/pdf.ts（如已提交），或删除各行前缀 "// "。
 * =====================================================================
 */
// /**
//  * PDF 文本提取工具（服务端）
//  *
//  * 基于 pdfjs-dist（legacy build，Node 兼容），把 PDF dataUrl 解析为纯文本，
//  * 注入用户消息 content 供模型理解。解析失败返回空字符串，不阻塞主流程。
//  */
// 
// /** 单份 PDF 提取的最大字符数（防超长文档撑爆上下文） */
// const MAX_PDF_CHARS = 20000;
// 
// /**
//  * 从 dataUrl 提取 PDF 文本。
//  * @param dataUrl 形如 data:application/pdf;base64,.... 的数据 URL
//  * @param maxChars 最大提取字符数
//  * @returns 提取到的文本（失败或空文档返回 ""）
//  */
// export async function extractPdfText(
//   dataUrl: string,
//   maxChars: number = MAX_PDF_CHARS
// ): Promise<string> {
//   if (!dataUrl || !dataUrl.startsWith("data:")) return "";
//   try {
//     // 动态 import：让 Next.js 将 pdfjs 作为独立服务端 chunk 打包
//     const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
//     const base64 = dataUrl.split(",")[1] ?? "";
//     const binary = atob(base64);
//     const bytes = new Uint8Array(binary.length);
//     for (let i = 0; i < binary.length; i++) {
//       bytes[i] = binary.charCodeAt(i);
//     }
// 
//     const doc = await pdfjs.getDocument({ data: bytes }).promise;
//     let text = "";
//     for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
//       const page = await doc.getPage(pageNum);
//       const content = await page.getTextContent();
//       const pageText = content.items
//         .map((item) => ("str" in item ? (item as { str: string }).str : ""))
//         .join(" ");
//       text += pageText + "\n";
//       if (text.length >= maxChars) break;
//     }
//     await doc.destroy();
//     return text.trim().slice(0, maxChars);
//   } catch {
//     return "";
//   }
// }
// 
