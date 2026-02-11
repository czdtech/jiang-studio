import React, { useState } from 'react';
import { FolderOpen, X, AlertTriangle } from 'lucide-react';
import { setGalleryDirectoryHandle } from '../services/db';

interface GallerySetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 选择目录成功后回调，参数为目录显示名 */
  onSuccess: (dirName: string) => void;
}

export const GallerySetupModal: React.FC<GallerySetupModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');

  const supported = typeof (window as any).showDirectoryPicker === 'function';

  const handlePick = async () => {
    if (!supported) return;
    setPicking(true);
    setError('');
    try {
      const handle = (await (window as any).showDirectoryPicker()) as FileSystemDirectoryHandle;
      await setGalleryDirectoryHandle(handle);
      onSuccess(handle.name || '图库目录');
    } catch (e: any) {
      // 用户取消选择不算错误
      if (e?.name !== 'AbortError') {
        setError('选择目录失败：' + (e?.message || '未知错误'));
      }
    } finally {
      setPicking(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — 不可点击关闭，强制用户做选择 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-dark-surface rounded-xl border border-dark-border shadow-2xl w-[440px] max-w-[90vw]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-border">
          <h3 className="text-base font-bold text-white">设置图库目录</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-300 leading-relaxed">
            为了节省浏览器存储空间，生成的原图需要保存到本地磁盘。请选择一个目录用于存放生成的图片。
          </p>

          <div className="bg-dark-bg/60 rounded-lg p-3 text-xs text-gray-400 space-y-1">
            <p>- 原图保存到你选择的目录（便于管理和备份）</p>
            <p>- 浏览器中仅保留缩略图索引（节省配额）</p>
            <p>- 后续可在「作品集」页面更换或清除目录</p>
          </div>

          {!supported && (
            <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
              <p className="text-xs text-yellow-300">
                当前浏览器不支持目录选择（File System Access API）。请使用 Chrome 或 Edge，并在
                localhost 或 https 下打开。
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-dark-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-dark-border text-sm text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
          >
            暂不设置
          </button>
          <button
            onClick={handlePick}
            disabled={!supported || picking}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-banana-500 text-black text-sm font-medium hover:bg-banana-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            {picking ? '选择中…' : '选择图库目录'}
          </button>
        </div>
      </div>
    </div>
  );
};
