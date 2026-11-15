/**
 * TTS 冒烟：清洗 → 分段 → mock 占位 wav 全链（doc/tts.md §3/§4/§6）。
 * 零依赖直跑：npm run smoke:tts（--experimental-strip-types）。
 * 不发上游请求、不校验密钥——网络链路用 MOCK_TTS=1 起 dev 后人工点按钮验证。
 */
import { cleanSpeechText } from '../lib/tts/clean.ts';
import {
  MAX_SPEECH_SEGMENTS,
  MAX_SPEECH_TOTAL_CHARS,
  splitSpeechSegments,
} from '../lib/tts/segments.ts';
import { TTS_ENGINES, defaultTtsVoice, engineHasVoice } from '../lib/tts/catalog.ts';
import { buildMockWav, toWavBase64 } from '../lib/tts/mock.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean) {
  if (cond) {
    passed += 1;
  } else {
    failures.push(name);
  }
}

/* ---------- 清洗（doc/tts.md §3） ---------- */
const cleaned = cleanSpeechText(
  '## 结论\n\n先看**要点**：\n\n```py\nprint(1)\n```\n\n- 甲乙\n- 丙丁\n\n详见[文档](https://a.b/c)。',
);
check(
  '清洗：代码块删除、标记去壳、链接留文字',
  cleaned === '结论\n先看要点：\n甲乙\n丙丁\n详见文档。',
);

check('清洗：纯代码块消息清洗后为空（empty_text 基础）', cleanSpeechText('```\nx\n```') === '');

/* ---------- 分段（doc/tts.md §4） ---------- */
const zhipuMax = TTS_ENGINES.find((e) => e.id === 'zhipu')?.maxSegmentChars ?? 0;
const segments = splitSpeechSegments('第一句。第二句！'.repeat(300), zhipuMax);
check('分段：段数在防呆上限内', segments.length <= MAX_SPEECH_SEGMENTS);
check('分段：任何段不超单段上限', segments.every((s) => s.length <= zhipuMax));
check('分段：拼接无损', segments.join('') === '第一句。第二句！'.repeat(300));

const longRun = splitSpeechSegments('啊'.repeat(MAX_SPEECH_TOTAL_CHARS + 1), zhipuMax);
check('分段：超总上限长串仍可切（总长门禁在上层拦）', longRun.every((s) => s.length <= zhipuMax));

/* ---------- 目录（doc/tts.md §2/§5） ---------- */
check('目录：两引擎且 zhipu 在前（默认引擎语义）', TTS_ENGINES.length === 2 && TTS_ENGINES[0].id === 'zhipu');
check('目录：zhipu 单段上限 1000', zhipuMax === 1000);
check(
  '目录：deepseek 单段上限 4000',
  (TTS_ENGINES.find((e) => e.id === 'deepseek')?.maxSegmentChars ?? 0) === 4000,
);
check('目录：默认音色归属正确', defaultTtsVoice('zhipu') === 'tongtong' && defaultTtsVoice('deepseek') === 'stella');
check('目录：音色归属校验', engineHasVoice('zhipu', 'tongtong') && !engineHasVoice('deepseek', 'tongtong'));

/* ---------- mock 占位 wav（doc/tts.md §6） ---------- */
const wav = buildMockWav();
const head = new TextDecoder().decode(wav.slice(0, 4)) + new TextDecoder().decode(wav.slice(8, 12));
const silent = new Uint8Array(wav.slice(44)).every((b) => b === 0);
check('mock：RIFF/WAVE 头齐全且数据段静音', head === 'RIFFWAVE' && silent);
check('mock：base64 可编码', toWavBase64(new Uint8Array(wav)).length > 0);

/* ---------- 汇总 ---------- */
if (failures.length > 0) {
  console.error(`smoke:tts 失败 ${failures.length}/${passed + failures.length}：`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log(`smoke:tts 全过（${passed} 项）`);
