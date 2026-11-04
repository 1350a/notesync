import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-800">
      <main className="flex flex-col items-center gap-8 p-10 bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-blue-600">错题认知诊断引擎</h1>
          <p className="text-slate-500">请选择你想要体验的交互模式</p>
        </div>

        <div className="flex flex-col w-64 gap-4 mt-4">
          {/* 按钮 1：跳转到传统聊天 */}
          <Link
            href="/chat"
            className="flex items-center justify-center w-full px-6 py-4 font-semibold text-white transition-colors bg-blue-500 rounded-xl hover:bg-blue-600 shadow-sm"
          >
            传统聊天界面
          </Link>

          {/* 按钮 2：跳转到新型上传 */}
          <Link
            href="/diagnose"
            className="flex items-center justify-center w-full px-6 py-4 font-semibold text-blue-600 transition-colors bg-blue-50 border border-blue-100 rounded-xl hover:bg-blue-100 shadow-sm"
          >
            新型上传界面
          </Link>
        </div>
      </main>
    </div>
  );
}
