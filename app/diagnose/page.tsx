'use client'
import { useState } from 'react'
export default function DiagnosePage() {
  const [selectedFile, setSelectedFile] = useState<File|null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [loading, setLoading] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setPreviewUrl(file.type.startsWith('image/') ? URL.createObjectURL(file) : '')
    }
  }
  const clearFile = () => {
    setSelectedFile(null)
    setPreviewUrl('')
  }
  const startDiagnose = () => {
    if (!selectedFile) return
    setLoading(true)
  }
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-100 to-teal-200 p-8 relative overflow-hidden">
      <div className="absolute top-10 left-10 text-9xl text-green-500/10 rotate-12">📖</div>
      <div className="absolute bottom-20 right-16 text-8xl text-teal-500/10 -rotate-12">✏️</div>
      <div className="absolute top-1/3 right-10 text-7xl text-emerald-500/10">📚</div>
      <main className="max-w-4xl mx-auto relative z-10">
        <h1 className="text-4xl font-bold mb-8 bg-clip-text text-transparent bg-gradient-to-r from-green-600 to-teal-500">错题认知诊断引擎</h1>
        <div className="bg-white/20 backdrop-blur-lg rounded-2xl p-8 shadow-xl border border-white/30 mb-8">
          <p className="text-lg text-white mb-4">上传你的错题照片或PDF</p>
          <input type="file" accept="image/*,.pdf" id="fileUpload" className="hidden" onChange={handleFileChange} />
          <div className="flex gap-3 flex-wrap">
            <button className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-full shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5" onClick={() => document.getElementById('fileUpload')?.click()}>选择文件</button>
            {selectedFile && <button className="bg-teal-500 hover:bg-teal-600 text-white px-6 py-3 rounded-full shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5" onClick={startDiagnose} disabled={loading}>{loading ? '诊断中...' : '开始诊断'}</button>}
          </div>
          {selectedFile && (
            <div className="mt-4 flex items-center gap-3">
              <p className="text-white">已选：{selectedFile.name}</p>
              <button className="bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-full shadow hover:shadow-md transition-all" onClick={clearFile}>删除</button>
            </div>
          )}
          {previewUrl && <img src={previewUrl} alt="预览" className="mt-4 max-w-full rounded-2xl shadow-lg" />}
        </div>
        <div className="bg-white/90 backdrop-blur-lg rounded-2xl p-6 shadow-xl">
          <h2 className="text-xl font-semibold mb-3 text-gray-800">诊断结果</h2>
          <p className="text-gray-700">等待上传错题文件后生成知识点分析和错因建议</p>
        </div>
      </main>
    </div>
  )
}
