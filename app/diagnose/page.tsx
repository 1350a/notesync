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
  return (<div className="min-h-screen p-8 relative overflow-hidden" style={{backgroundColor:"var(--bg-color)"}}>
    <div className="absolute top-10 left-10 text-9xl opacity-10 rotate-12">📖</div>
    <div className="absolute bottom-20 right-16 text-8xl opacity-10 -rotate-12">✏️</div>
    <div className="absolute top-1/3 right-10 text-7xl opacity-10">📚</div>

    <main className="max-w-4xl mx-auto relative z-10">
      <h1 className="text-4xl font-bold mb-8" style={{color:"var(--text-color)"}}>错题认知诊断引擎</h1>
      <div style={{backgroundColor:"var(--card-bg)"}} className="backdrop-blur-lg rounded-2xl p-6 shadow-xl">
        <p style={{color:"var(--text-color)"}} className="mb-4">上传你的错题照片或PDF</p >
        <input type="file" accept="image/*,.pdf" id="fileUpload" className="hidden" onChange={handleFileChange}/>
        <div className="flex gap-3 flex-wrap">
          <button style={{backgroundColor:"var(--primary-color)"}} className="hover:opacity-90 text-white px-6 py-3 rounded-full shadow-lg">
            选择文件
          </button>
          {selectedFile && (
            <div className="flex items-center gap-3">
              <p style={{color:"var(--text-color)"}}>已选：{selectedFile.name}</p >
              <button style={{backgroundColor:"var(--primary-color)"}} className="hover:opacity-90 text-white px-4 py-2 rounded-full shadow">
                诊断
              </button>
            </div>
          )}
        </div>
        {previewUrl && < img src={previewUrl} alt="预览" className="mt-4 max-w-full rounded-2xl shadow-lg"/>}
      </div>
      <div style={{backgroundColor:"var(--card-bg)"}} className="backdrop-blur-lg rounded-2xl p-6 shadow-xl mt-4">
        <h2 style={{color:"var(--text-color)"}} className="font-semibold mb-3">诊断结果</h2>
        <p style={{color:"var(--text-color)"}}>等待上传错题文件后生成知识点分析和错因建议</p >
      </div>
    </main>
  </div>
   )
}
