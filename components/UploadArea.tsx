'use client';

import { useRef, useState } from 'react';

// 定义我们要的四种类型
const FILE_TYPES = [
  { id: 'origin', label: '错题原题', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { id: 'wrong', label: '错误答案', color: 'bg-red-100 text-red-700 border-red-200' },
  { id: 'correct', label: '正确答案', color: 'bg-green-100 text-green-700 border-green-200' },
  { id: 'analysis', label: '标准解析', color: 'bg-purple-100 text-purple-700 border-purple-200' },
];

type FileItem = {
  id: string;
  name: string;
  type: string; // 对应 FILE_TYPES 的 id
};

export default function UploadArea() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理拖拽放下
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  };

  // 处理点击选择文件
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  };

  // 统一添加文件逻辑
  const addFiles = (newFiles: File[]) => {
    const newItems = newFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      type: 'origin', // 默认先设为原题，让用户自己改
    }));
    setFiles((prev) => [...prev, ...newItems]);
  };

  // 改变文件分类
  const changeType = (id: string, newType: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, type: newType } : f)));
  };

  // 移除文件
  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // 点击开始诊断（这里就是模拟发送接口的地方）
  const handleSubmit = () => {
    const payload = files.map((f) => ({ name: f.name, type: f.type, content: '模拟的文件数据' }));
    console.log('即将发送给接口的数据：', payload);
    alert(`已准备好 ${files.length} 个文件，即将开始 AI 诊断！（请按 F12 查看控制台输出）`);
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* 拖拽/上传区域 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:bg-slate-50'
        }`}
      >
        <input
          type="file"
          multiple
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileSelect}
        />
        <div className="text-4xl mb-4">📁</div>
        <p className="text-lg font-medium text-slate-700">点击或拖拽文件到这里</p>
        <p className="text-sm text-slate-500 mt-2">支持一次上传多个文件（图片 / PDF）</p>
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          <h3 className="font-semibold text-slate-800">已上传文件 ({files.length})</h3>
          <div className="space-y-3">
            {files.map((file) => {
              const currentTypeInfo = FILE_TYPES.find((t) => t.id === file.type) || FILE_TYPES[0];
              return (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100"
                >
                  <div className="flex items-center gap-3 truncate">
                    <span className="text-xl">📄</span>
                    <span className="text-sm text-slate-700 truncate max-w-50">{file.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={file.type}
                      onChange={(e) => changeType(file.id, e.target.value)}
                      className={`text-sm px-3 py-1.5 rounded-lg border font-medium outline-none cursor-pointer ${currentTypeInfo.color}`}
                    >
                      {FILE_TYPES.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeFile(file.id)}
                      className="text-slate-400 hover:text-red-500 transition-colors p-2"
                      title="移除文件"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={handleSubmit}
            className="w-full py-4 mt-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            开始诊断
          </button>
        </div>
      )}
    </div>
  );
}
