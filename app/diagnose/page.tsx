import UploadArea from '@/components/UploadArea';

export default function DiagnosePage() {
  return (
    <div className="min-h-screen bg-slate-50 p-8 flex flex-col items-center">
      <div className="text-center mb-10 mt-10">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">新型错题诊断</h1>
        <p className="text-slate-500">请上传错题文件，并根据类型进行分类</p>
      </div>

      {/* 引入刚刚写的核心组件 */}
      <UploadArea />
    </div>
  );
}
