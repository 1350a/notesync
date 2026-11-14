import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import UploadPrivacyNotice from '@/components/upload/UploadPrivacyNotice';
import { imageLeavesDevice } from '@/lib/ocr/image-handling';
import {
  filePrivacyDetail,
  imagePrivacyDetail,
  imagePrivacyShort,
  PRIVACY_DETAIL_DOC,
  PRIVACY_DETAIL_IMAGE_CLOUD,
  PRIVACY_DETAIL_IMAGE_DIRECT,
  PRIVACY_DETAIL_IMAGE_LOCAL,
  PRIVACY_SHORT_LOCAL,
  PRIVACY_SHORT_REMOTE,
} from '@/lib/ui/notices';

/**
 * 上传隐私提醒的红线用例。
 *
 * 锁死四件事（后续谁改文案/改发送路径都会先撞到这里）：
 * 1. 「图片是否出设备」的判定与发送管线同源，不让文案和实现对不上；
 * 2. 图片三种去向的文案各不相同且都给出「可切本地」的动作指引，不写泛泛免责；
 * 3. 文件类文案区分「浏览器内解析」与「旧版 .doc 经本站服务端」，不把图片 OCR
 *    与通用文件上传混成一句；
 * 4. 两个上传入口的源码里确实挂载了这个组件（防止有人删掉挂载、页面静默失去提醒）。
 */
const readSource = (relative: string) =>
  readFileSync(join(process.cwd(), relative), 'utf8');

describe('图片是否出设备的判定', () => {
  it('多模态直传一定出设备，云端 OCR 也出设备，只有本地引擎转写不出设备', () => {
    expect(imageLeavesDevice('direct', 'local')).toBe(true);
    expect(imageLeavesDevice('direct', 'cloud')).toBe(true);
    expect(imageLeavesDevice('ocr-text', 'cloud')).toBe(true);
    expect(imageLeavesDevice('ocr-text', 'local')).toBe(false);
  });
});

describe('上传隐私文案：图片', () => {
  it('云端 OCR：说清去向、本站不落盘、服务商条款为准，并给出切本地指引', () => {
    expect(PRIVACY_DETAIL_IMAGE_CLOUD).toContain('第三方模型服务商');
    expect(PRIVACY_DETAIL_IMAGE_CLOUD).toContain('智谱');
    expect(PRIVACY_DETAIL_IMAGE_CLOUD).toContain('不保存');
    expect(PRIVACY_DETAIL_IMAGE_CLOUD).toContain('服务条款');
    expect(PRIVACY_DETAIL_IMAGE_CLOUD).toContain('本地');
    expect(PRIVACY_DETAIL_IMAGE_CLOUD).toContain('设置');
  });

  it('多模态直传：明确是「原图」上传，并提示改纯文本模型或本地识别', () => {
    expect(PRIVACY_DETAIL_IMAGE_DIRECT).toContain('原图');
    expect(PRIVACY_DETAIL_IMAGE_DIRECT).toContain('纯文本模型');
    expect(PRIVACY_DETAIL_IMAGE_DIRECT).toContain('本地');
    // 直传与云端 OCR 是两条不同路径，文案不能复用同一句
    expect(PRIVACY_DETAIL_IMAGE_DIRECT).not.toBe(PRIVACY_DETAIL_IMAGE_CLOUD);
  });

  it('本地引擎转写：如实说明原图不出设备，但仍会发送识别出的文字', () => {
    expect(PRIVACY_DETAIL_IMAGE_LOCAL).toContain('原图不出设备');
    expect(PRIVACY_DETAIL_IMAGE_LOCAL).toContain('第三方模型服务商');
    expect(PRIVACY_DETAIL_IMAGE_LOCAL).not.toContain('原图上传');
  });

  it('常驻短句按「模式 × 引擎」派生，且都带设置页指引', () => {
    expect(imagePrivacyShort('direct', 'local')).toBe(PRIVACY_SHORT_REMOTE);
    expect(imagePrivacyShort('ocr-text', 'cloud')).toBe(PRIVACY_SHORT_REMOTE);
    expect(imagePrivacyShort('ocr-text', 'local')).toBe(PRIVACY_SHORT_LOCAL);
    expect(PRIVACY_SHORT_REMOTE).toContain('设置');
    expect(PRIVACY_SHORT_REMOTE).toContain('本地');
    expect(PRIVACY_SHORT_LOCAL).toContain('原图不出设备');
    // 详细版必须比常驻短句更长：短句一行带过，详细版才承载三点说明
    expect(imagePrivacyDetail('ocr-text', 'cloud').length).toBeGreaterThan(
      PRIVACY_SHORT_REMOTE.length,
    );
  });
});

describe('上传隐私文案：文件', () => {
  it('普通文件：浏览器内解析，只有解析结果随消息出设备', () => {
    expect(filePrivacyDetail('other')).toContain('浏览器内解析');
    expect(filePrivacyDetail('other')).toContain('站');
    expect(filePrivacyDetail('other')).not.toContain('智谱');
  });

  it('旧版 .doc：如实说明需先上传本站服务端解析，且不涉及第三方', () => {
    expect(PRIVACY_DETAIL_DOC).toContain('本站服务端');
    expect(PRIVACY_DETAIL_DOC).toContain('不涉及第三方');
    expect(filePrivacyDetail('doc')).toBe(PRIVACY_DETAIL_DOC);
    expect(filePrivacyDetail('doc')).not.toBe(filePrivacyDetail('other'));
  });
});

describe('UploadPrivacyNotice 组件', () => {
  it('常驻短句渲染出文案，并带出设备标记', () => {
    const html = renderToStaticMarkup(
      createElement(UploadPrivacyNotice, { mode: 'ocr-text', engine: 'cloud' }),
    );
    expect(html).toContain(PRIVACY_SHORT_REMOTE);
    expect(html).toContain('data-privacy-remote="true"');
  });

  it('本地引擎 + OCR 转写时标记为不出设备', () => {
    const html = renderToStaticMarkup(
      createElement(UploadPrivacyNotice, { mode: 'ocr-text', engine: 'local' }),
    );
    expect(html).toContain(PRIVACY_SHORT_LOCAL);
    expect(html).toContain('data-privacy-remote="false"');
  });

  it('detail 变体渲染完整说明，供诊断上传区常驻展示', () => {
    const html = renderToStaticMarkup(
      createElement(UploadPrivacyNotice, {
        mode: 'direct',
        engine: 'cloud',
        variant: 'detail',
      }),
    );
    expect(html).toContain(PRIVACY_DETAIL_IMAGE_DIRECT);
  });
});

describe('上传入口确实挂了提醒（源码级防回退）', () => {
  it('聊天输入区：常驻组件 + 首次选文件的一次性说明', () => {
    const source = readSource('components/chat/ChatInput.tsx');
    expect(source).toContain('UploadPrivacyNotice');
    expect(source).toContain('imagePrivacyDetail');
    expect(source).toContain('filePrivacyDetail');
  });

  it('诊断上传区：常驻完整说明（图片行 + 文件行）', () => {
    const source = readSource('app/(main)/diagnose/_components/UploadArea.tsx');
    expect(source).toContain('UploadPrivacyNotice');
    expect(source).toContain('filePrivacyDetail');
  });

  it('设置页保留本地识别开关，并在云端档说明数据流向', () => {
    const source = readSource('components/settings/LocalCapabilitySection.tsx');
    expect(source).toContain("ocr: { engine: 'local' }");
    expect(source).toContain('图片处理（OCR）');
    expect(source).toContain('服务商');
  });
});
