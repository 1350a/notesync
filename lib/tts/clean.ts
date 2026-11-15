/**
 * 朗读文本清洗（doc/tts.md §3）：markdown 源 → 可听纯文本。
 *
 * 为什么服务端统一做：DeepSeek 有 filter_markdown 而 GLM 没有，两家口径必须一致；
 * 且标记符号读出声、代码块/URL 不可听的问题需要远比 filter_markdown 更细的规则。
 * 纯函数、顺序即实现顺序（围栏代码块最先，防止其内容被后续规则误改）。
 */
export function cleanSpeechText(md: string): string {
  let text = md;
  // 围栏代码块整块删除：朗读代码无意义且极费字符，讲解文字通常在块外。
  // 替换为空串而非空格——块多在独立行，残留空格行会留「只有空格的朗读段」
  text = text.replace(/```[\s\S]*?```/g, '');
  // 块级公式删除：LaTeX 读出为乱码；块级公式通常伴随讲解文字（空行随压缩收口）
  text = text.replace(/\$\$[\s\S]*?\$\$/g, '');
  // 图片删除；链接保留显示文本
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1');
  // 裸 URL 删除（链接语法已消费，剩余 http(s) 独立串不可听）
  text = text.replace(/https?:\/\/\S+/g, ' ');
  // 行内公式去定界符保留原文（简单式子如 x=1 可听，删除丢语义）
  text = text.replace(/\$([^$\n]+)\$/g, '$1');
  // HTML 标签剥壳留文字（markdown 源可能含内联 HTML）
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  // 行内代码去反引号保留内容（变量名、数字有语义）
  text = text.replace(/`([^`]*)`/g, '$1');
  // 加粗/斜体/删除线标记去壳留文字
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');
  // 下划线斜体：两侧必须贴非词字符，避免 snake_case（file_name）被误拆
  text = text.replace(/(?<![\w])_([^_]+)_(?![\w])/g, '$1');
  // 水平线删除（独立行 --- / ***；空行随压缩收口）
  text = text.replace(/^\s*([-*]){3,}\s*$/gm, '');
  // 标题/引用/列表标记去壳留文字（有序列表的数字是内容，保留）
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^\s*>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  // 表格逐行平铺：分隔行丢弃，数据行单元格以「，」连接（表格不可听，但整表删除丢内容）
  text = text
    .split('\n')
    .map((line) => {
      const row = /^\s*\|(.*)\|\s*$/.exec(line);
      if (!row) return line;
      const cells = row[1].split('|').map((cell) => cell.trim());
      // 分隔行（| :--- | ---: |）丢弃整行：残留空格行会混进朗读段
      if (cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return '';
      return cells.filter(Boolean).join('，');
    })
    .join('\n');
  // 空白压缩：制表/多空格归一（保留换行作句界），连续空行合并，首尾清理
  text = text.replace(/[^\S\n]+/g, ' ');
  text = text.replace(/\n{2,}/g, '\n');
  return text.trim();
}
