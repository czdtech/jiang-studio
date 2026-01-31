import React, { useState, useEffect } from 'react';
import { X, Download, Edit, ChevronLeft, ChevronRight } from 'lucide-react';
import { GeneratedImage } from '../types';

interface ImagePreviewModalProps {
  data: { images: GeneratedImage[]; index: number } | null;
  onClose: () => void;
  onEdit: (img: GeneratedImage) => void;
}

export const ImagePreviewModal = ({
  data,
  onClose,
  onEdit
}: ImagePreviewModalProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [resolvedObjectUrl, setResolvedObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    // 防止上一次预览停留在较大 index，下一次打开时 images 变短导致越界崩溃
    const clamped = Math.max(0, Math.min(data.index, Math.max(0, data.images.length - 1)));
    setCurrentIndex(clamped);
  }, [data]);

  useEffect(() => {
    if (!data || data.images.length === 0) return;

    const safeIndex = Math.max(0, Math.min(currentIndex, data.images.length - 1));
    const img = data.images[safeIndex];

    let cancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      if (!img?.fileHandle) {
        setResolvedObjectUrl(null);
        return;
      }
      try {
        const file = await img.fileHandle.getFile();
        objectUrl = URL.createObjectURL(file);
        if (!cancelled) setResolvedObjectUrl(objectUrl);
      } catch {
        if (!cancelled) setResolvedObjectUrl(null);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data, currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!data) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && currentIndex < data.images.length - 1) setCurrentIndex(i => i + 1);
      if (e.key === 'ArrowLeft' && currentIndex > 0) setCurrentIndex(i => i - 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data, currentIndex, onClose]);

  if (!data) return null;

  if (data.images.length === 0) return null;

  const safeIndex = Math.max(0, Math.min(currentIndex, data.images.length - 1));
  const currentImage = data.images[safeIndex];
  if (!currentImage) return null;

  const hasNext = safeIndex < data.images.length - 1;
  const hasPrev = safeIndex > 0;

  const displayUrl = resolvedObjectUrl || currentImage.base64;
  const downloadName = currentImage.fileName || `nano-banana-${currentImage.id}.png`;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur-sm text-white">
       {/* Top Controls */}
       <div className="shrink-0 p-4 flex justify-between items-center bg-dark-surface/60 backdrop-blur-sm border-b border-dark-border">
          <div className="flex gap-2 text-sm font-mono text-gray-400">
             <span>{safeIndex + 1} / {data.images.length}</span>
             <span className="text-gray-600">|</span>
             <span>{currentImage.params.imageSize || 'STD'}</span>
          </div>
          <div className="flex items-center gap-3">
             <button 
               onClick={() => { onClose(); onEdit(currentImage); }}
               className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm"
             >
               <Edit className="w-4 h-4" /> 编辑
             </button>
             <a 
               href={displayUrl} 
               download={downloadName}
               aria-label="下载图片"
               className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
             >
               <Download className="w-5 h-5" />
             </a>
             <button 
               onClick={onClose}
               aria-label="关闭预览"
               className="p-2 hover:bg-red-500/20 hover:text-red-500 text-gray-400 transition-colors rounded-lg"
             >
               <X className="w-6 h-6" />
             </button>
          </div>
       </div>

       {/* Main Image Area */}
       <div className="flex-1 relative min-h-0 w-full flex items-center justify-center p-4 overflow-hidden">
          {hasPrev && (
            <button 
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              aria-label="上一张"
              className="absolute left-4 p-3 bg-black/50 hover:bg-banana-500 text-white hover:text-black rounded-full transition-colors z-20"
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
          )}

          <img 
            src={displayUrl} 
            alt={currentImage.prompt} 
            className="max-h-full max-w-full object-contain shadow-2xl"
          />

          {hasNext && (
            <button 
              onClick={() => setCurrentIndex((i) => Math.min(data.images.length - 1, i + 1))}
              aria-label="下一张"
              className="absolute right-4 p-3 bg-black/50 hover:bg-banana-500 text-white hover:text-black rounded-full transition-colors z-20"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          )}
       </div>

       {/* Bottom Info Area */}
       <div className="shrink-0 p-6 bg-dark-surface/60 backdrop-blur-sm border-t border-dark-border">
          <p className="text-white text-base md:text-lg max-w-4xl mx-auto text-center">{currentImage.prompt}</p>
          <p className="text-gray-500 text-xs mt-2 text-center">{new Date(currentImage.timestamp).toLocaleString()}</p>
       </div>
    </div>
  );
};
