import React from 'react';
import { Sparkles, Edit, Download, Image, AlertTriangle } from 'lucide-react';
import { GeneratedImage, GenerationParams } from '../types';

export type ImageGridSlot =
  | { id: string; status: 'pending' }
  | { id: string; status: 'success'; image: GeneratedImage }
  | { id: string; status: 'error'; error?: string };

interface ImageGridProps {
  images: GeneratedImage[];
  slots?: ImageGridSlot[];
  isGenerating: boolean;
  params: GenerationParams;
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
}

export const ImageGrid = ({
  images,
  slots,
  isGenerating,
  params,
  onImageClick,
  onEdit
}: ImageGridProps) => {
  const hasSlots = !!slots && slots.length > 0;

  if (!hasSlots && images.length === 0 && !isGenerating) {
    return (
      <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-gray-500 bg-dark-surface/30 rounded-2xl border-2 border-dashed border-dark-border">
        <Image className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-sm text-gray-400">生成结果会显示在这里</p>
        <p className="mt-2 text-xs text-gray-600">在下方输入提示词后点击“生成”开始</p>
      </div>
    );
  }

  const totalCards = hasSlots ? slots.length : (isGenerating ? params.count : images.length);

  const gridCols = totalCards > 4
    ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
    : 'grid-cols-1 md:grid-cols-2';

  if (hasSlots) {
    const successImages = slots
      .filter((s): s is Extract<ImageGridSlot, { status: 'success' }> => s.status === 'success')
      .map((s) => s.image);

    let successIndex = -1;

    return (
      <div className={`grid gap-4 ${gridCols}`}>
        {slots.map((slot) => {
          if (slot.status === 'pending') {
            return (
              <div
                key={slot.id}
                className="aspect-square bg-dark-surface rounded-xl border border-dark-border animate-pulse flex items-center justify-center"
              >
                <Sparkles className="text-banana-500/30 w-12 h-12 animate-pulse" />
              </div>
            );
          }

          if (slot.status === 'error') {
            return (
              <div
                key={slot.id}
                className="aspect-square bg-dark-surface/30 rounded-xl border border-red-500/40 flex flex-col items-center justify-center p-4 text-center"
              >
                <AlertTriangle className="w-10 h-10 text-red-400/80 mb-3" />
                <p className="text-sm font-semibold text-red-200">生成失败</p>
                <p className="text-xs text-red-200/70 mt-2 line-clamp-4">
                  {slot.error || '请重试或更换模型/中转'}
                </p>
              </div>
            );
          }

          // success
          successIndex++;
          const img = slot.image;
          const idx = successIndex;

          return (
            <div
              key={slot.id}
              role="button"
              tabIndex={0}
              className="group relative aspect-square bg-black rounded-xl overflow-hidden border border-dark-border shadow-xl cursor-pointer hover:border-banana-500/50 transition-all duration-200"
              onClick={() => onImageClick(successImages, idx)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onImageClick(successImages, idx);
                }
              }}
            >
              <img src={img.base64} alt={img.prompt} className="w-full h-full object-contain" />

              {/* Overlay Controls */}
              <div className="absolute inset-0 bg-black/60 opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-4">
                <div className="flex gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(img); }}
                    className="bg-white text-black px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-banana-400 transition-colors"
                  >
                    <Edit className="w-4 h-4" /> 编辑
                  </button>
                  <a
                    href={img.base64}
                    download={`nano-banana-${img.id}.png`}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="下载图片"
                    className="bg-dark-surface text-white px-3 py-2 rounded-lg border border-dark-border hover:bg-dark-border"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent pointer-events-none">
                  <p className="text-xs text-white line-clamp-2 text-center px-2">{img.prompt}</p>
                  <div className="flex justify-between items-center px-2 mt-1">
                    <span className="text-[10px] text-gray-300 uppercase bg-black/50 px-1 rounded">{img.params.imageSize || '1K'}</span>
                    <span className="text-[10px] text-gray-300 uppercase bg-black/50 px-1 rounded">{img.params.aspectRatio}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`grid gap-4 ${gridCols}`}>
      {!hasSlots && isGenerating && params.count > images.length && (
        // Simple Skeleton
        Array.from({ length: params.count }).map((_, i) => (
          <div key={i} className="aspect-square bg-dark-surface rounded-xl border border-dark-border animate-pulse flex items-center justify-center">
            <Sparkles className="text-banana-500/30 w-12 h-12 animate-pulse" />
          </div>
        ))
      )}
      {images.map((img, idx) => (
        <div
          key={img.id}
          role="button"
          tabIndex={0}
          className="group relative aspect-square bg-black rounded-xl overflow-hidden border border-dark-border shadow-xl cursor-pointer hover:border-banana-500/50 transition-all duration-200"
          onClick={() => onImageClick(images, idx)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onImageClick(images, idx);
            }
          }}
        >
          <img src={img.base64} alt={img.prompt} className="w-full h-full object-contain" />

          {/* Overlay Controls */}
          <div className="absolute inset-0 bg-black/60 opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-4">
            <div className="flex gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(img); }}
                className="bg-white text-black px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-banana-400 transition-colors"
              >
                <Edit className="w-4 h-4" /> 编辑
              </button>
              <a
                href={img.base64}
                download={`nano-banana-${img.id}.png`}
                onClick={(e) => e.stopPropagation()}
                aria-label="下载图片"
                className="bg-dark-surface text-white px-3 py-2 rounded-lg border border-dark-border hover:bg-dark-border"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent pointer-events-none">
              <p className="text-xs text-white line-clamp-2 text-center px-2">{img.prompt}</p>
              <div className="flex justify-between items-center px-2 mt-1">
                <span className="text-[10px] text-gray-300 uppercase bg-black/50 px-1 rounded">{img.params.imageSize || '1K'}</span>
                <span className="text-[10px] text-gray-300 uppercase bg-black/50 px-1 rounded">{img.params.aspectRatio}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
