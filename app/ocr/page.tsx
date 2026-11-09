import AppLayout from '@/components/layout/AppLayout';

import OcrTestPanel from './_components/ocr-test-panel';

export default function OcrPage() {
  return (
    <AppLayout>
      <div className="p-8 max-w-4xl mx-auto w-full">
        <div className="text-center mb-10 mt-4">
          <h1 className="text-3xl font-bold mb-2">本地 OCR 能力页</h1>
          <p className="text-muted-foreground">
            识别完全在浏览器内完成，图片与识别文本均不上传服务器
          </p>
        </div>
        <OcrTestPanel />
      </div>
    </AppLayout>
  );
}
