import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-slate-100 p-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-6">错题认知诊断引擎</h1>
        <p className="text-xl text-slate-300 mb-2">不是简单搜题给答案</p >
        <p className="text-xl text-slate-300 mb-10">上传/粘贴错题，定位知识薄弱点，生成个性化复习方案</p >
        <Link href="/diagnose">
          <button className="px-8 py-3 bg-blue-500 hover:bg-blue-600 rounded-xl text-lg transition">
            定位到聊天位置
          </button>
        </Link>
      </div>
    </main>
  )
}
