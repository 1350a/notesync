'use client';

import { Button } from '@/components/ui/button';
import { useRef, useState } from 'react';

export default function ChatInput({
  onSend,
  onStop,
  loading,
}: {
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
  loading: boolean;
}) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 将文件转 Base64
  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (typeof e.target?.result === 'string') {
        setImages((prev) => [...prev, e.target!.result as string]);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach(readFile);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) readFile(file);
      }
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if ((!input.trim() && images.length === 0) || loading) return;
    onSend(input.trim(), images);
    setInput('');
    setImages([]);
  };

  return (
    <div className="mx-auto flex flex-col gap-2 max-w-3xl w-full">
      {/* 图片预览 */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {images.map((img, idx) => (
            <div key={idx} className="relative group">
              <img
                src={img}
                alt="preview"
                className="h-16 w-16 object-cover rounded-lg border border-border shadow-sm"
              />
              <button
                onClick={() => removeImage(idx)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Button
          variant="outline"
          size="icon"
          className="shrink-0 rounded-xl h-[46px] w-[46px]"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          title="上传图片"
        >
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileSelect}
          />
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </Button>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder="输入你的问题，支持粘贴图片，回车发送…"
          className="flex-1 min-h-[46px] max-h-40 resize-none rounded-xl border px-4 py-3 text-sm outline-none transition-colors bg-background focus:border-ring focus:ring-1 focus:ring-ring/30"
        />

        {loading ? (
          <Button
            onClick={onStop}
            variant="destructive"
            className="shrink-0 rounded-xl h-[46px] px-6"
          >
            停止
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            disabled={!input.trim() && images.length === 0}
            className="shrink-0 rounded-xl h-[46px] px-6"
          >
            发送
          </Button>
        )}
      </div>
    </div>
  );
}
