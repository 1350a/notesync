/**
 * word-extractor 无自带类型（package.json 无 types 字段），按其 README API 补
 * 环境声明；仅声明本项目用到的最小面。
 */
declare module 'word-extractor' {
  /** 解析出的文档对象；body 是正文文本 */
  export interface WordDocument {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(): string;
    getFooters(): string;
  }

  export class WordExtractor {
    /** 接受文件路径或 Buffer；解析失败 reject */
    extract(input: Buffer | string): Promise<WordDocument>;
  }

  // CJS 导出形态 module.exports = WordExtractor：esModuleInterop 下默认导入即类本身
  export default WordExtractor;
}
