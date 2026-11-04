'use client';
import { useState } from 'react';

export default function ChatInput({
  onSend,
  loading,
}: {
  onSend: (text: string) => void;
  loading: boolean;
}) {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim() || loading) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="mx-auto flex max-w-3xl gap-3 w-full">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder="输入你的问题，回车发送…"
        className="flex-1 rounded-2xl px-4 py-3 text-sm outline-none placeholder:text-sm"
        style={{
          border: '1px solid var(--border)',
          backgroundColor: 'var(--panel-soft)',
          color: 'var(--text)',
        }}
      />
      <button
        onClick={handleSend}
        disabled={loading || !input.trim()}
        className="rounded-2xl px-6 py-3 text-sm font-medium transition disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-text)' }}
      >
        发送
      </button>
    </div>
  );
}
