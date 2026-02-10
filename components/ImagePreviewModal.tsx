import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Edit, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
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
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptClamped, setPromptClamped] = useState(false);
  const promptRef = useRef<HTMLParagraphElement>(null);
  
  // 用于跟踪当前有效的 Blob URL，确保切换图片时不会使用已释放的 URL
  const objectUrlRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    // 防止上一次预览停留在较大 index，下一次打开时 images 变短导致越界崩溃
    const clamped = Math.max(0, Math.min(data.index, Math.max(0, data.images.length - 1)));
    setCurrentIndex(clamped);
  }, [data]);

  // 当 currentIndex 改变时，立即清空 resolvedObjectUrl 并释放旧的 Blob URL
  // 这样可以避免在渲染时使用已释放的 URL
  const handleIndexChange = React.useCallback((newIndex: number | ((prev: number) => number)) => {
    // 先释放旧的 Blob URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    // 清空状态，让组件先显示缩略图
    setResolvedObjectUrl(null);
    // 更新 index
    setCurrentIndex(newIndex);
  }, []);

  useEffect(() => {
    if (!data || data.images.length === 0) {
      setResolvedObjectUrl(null);
      return;
    }

    const safeIndex = Math.max(0, Math.min(currentIndex, data.images.length - 1));
    const img = data.images[safeIndex];

    let cancelled = false;

    const load = async () => {
      if (!img?.fileHandle) {
        return;
      }
      try {
        const file = await img.fileHandle.getFile();
        const newObjectUrl = URL.createObjectURL(file);
        if (!cancelled) {
          objectUrlRef.current = newObjectUrl;
          setResolvedObjectUrl(newObjectUrl);
        } else {
          // 如果已取消，立即释放新创建的 URL
          URL.revokeObjectURL(newObjectUrl);
        }
      } catch {
        // 加载失败时保持使用缩略图
      }
    };

    void load();

    return () => {
      cancelled = true;
      // 注意：不在这里释放 URL，由 handleIndexChange 或组件卸载时处理
    };
  }, [data, currentIndex]);
  
  // 组件卸载时释放 Blob URL
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // 检测提示词是否被截断（需要展开按钮）
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    // scrollHeight > clientHeight 说明文本溢出了
    setPromptClamped(el.scrollHeight > el.clientHeight + 1);
  }, [data, currentIndex, promptExpanded]);

  // 切换图片时重置展开状态
  useEffect(() => {
    setPromptExpanded(false);
  }, [currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!data) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && currentIndex < data.images.length - 1) handleIndexChange(i => i + 1);
      if (e.key === 'ArrowLeft' && currentIndex > 0) handleIndexChange(i => i - 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data, currentIndex, onClose, handleIndexChange]);

  if (!data) return null;

  if (data.images.length === 0) return null;

  const safeIndex = Math.max(0, Math.min(currentIndex, data.images.length - 1));
  const currentImage = data.images[safeIndex];
  if (!currentImage) return null;

  const hasNext = safeIndex < data.images.length - 1;
  const hasPrev = safeIndex > 0;

  // 优先使用高清图（resolvedObjectUrl），否则使用缩略图（base64）
  // 如果 base64 是 blob URL 或 http URL（可能已失效），使用占位符
  const fallbackUrl = currentImage.base64?.startsWith('data:') ? currentImage.base64 : '';
  const displayUrl = resolvedObjectUrl || fallbackUrl;
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
              onClick={() => handleIndexChange((i) => Math.max(0, i - 1))}
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
              onClick={() => handleIndexChange((i) => Math.min(data.images.length - 1, i + 1))}
              aria-label="下一张"
              className="absolute right-4 p-3 bg-black/50 hover:bg-banana-500 text-white hover:text-black rounded-full transition-colors z-20"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          )}
       </div>

       {/* Bottom Info Area */}
       <div className="shrink-0 p-6 bg-dark-surface/60 backdrop-blur-sm border-t border-dark-border">
          <p
            ref={promptRef}
            className={`text-white text-base md:text-lg max-w-4xl mx-auto text-center transition-all duration-200 ${
              promptExpanded ? '' : 'line-clamp-3'
            }`}
          >
            {currentImage.prompt}
          </p>
          {(promptClamped || promptExpanded) && (
            <button
              onClick={() => setPromptExpanded(prev => !prev)}
              className="mt-1.5 mx-auto flex items-center gap-1 text-xs text-gray-400 hover:text-banana-400 transition-colors"
            >
              {promptExpanded ? (
                <><ChevronUp className="w-3.5 h-3.5" />收起</>
              ) : (
                <><ChevronDown className="w-3.5 h-3.5" />展开全部</>
              )}
            </button>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-400">
            <span>模型：{currentImage.model || '-'}</span>
            <span>尺寸：{currentImage.params.imageSize || 'STD'}</span>
            <span>比例：{currentImage.params.aspectRatio || 'auto'}</span>
            <span>时间：{new Date(currentImage.timestamp).toLocaleString()}</span>
          </div>
       </div>
    </div>
  );
};
