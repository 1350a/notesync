import AppLayout from '@/components/layout/AppLayout';
import UploadArea from '@/components/UploadArea';

export default function DiagnosePage() {
  return (
    <AppLayout>
      <div className="p-8 max-w-4xl mx-auto w-full">
        <div className="text-center mb-10 mt-4">
          <h1 className="text-3xl font-bold mb-2">新型错题诊断</h1>
          <p className="text-muted-foreground">请上传错题文件，并根据类型进行分类</p>
        </div>
        <UploadArea />
      </div>
    </AppLayout>
  );
}
