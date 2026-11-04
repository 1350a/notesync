'use client';

export default function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg p-6 bg-white rounded-2xl shadow-xl">
        <h2 className="text-xl font-bold mb-4 text-black">系统设置</h2>
        <p className="text-gray-600 mb-6">这里以后会放 API Key 和主题配置。</p>
        <button onClick={onClose} className="px-5 py-2 text-white bg-blue-600 rounded-lg">
          关闭
        </button>
      </div>
    </div>
  );
}
