import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  expectedCount?: number;
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
}

const MIN_CARD_SIZE = 72;
const GRID_GAP = 16;

export const ImageGrid = ({
  images,
  slots,
  isGenerating,
  params,
  expectedCount,
  onImageClick,
  onEdit
}: ImageGridProps) => {
  const hasSlots = !!slots && slots.length > 0;
  const showEmptyState = !hasSlots && images.length === 0 && !isGenerating;
  const totalCards = hasSlots ? slots.length : (isGenerating ? (expectedCount ?? params.count) : images.length);
  const displayCards = Math.max(totalCards, 1);
  const remainingCards = Math.max(totalCards - images.length, 0);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridLayout, setGridLayout] = useState<{ cols: number; size: number }>({
    cols: 1,
    size: MIN_CARD_SIZE,
  });

  const computeLayout = useCallback((width: number, height: number, count: number) => {
    const safeCount = Math.max(1, count);
    const safeWidth = Math.max(0, width);
    const safeHeight = Math.max(0, height);
    let bestCols = 1;
    let bestSize = 0;

    for (let cols = 1; cols <= safeCount; cols++) {
      const rows = Math.ceil(safeCount / cols);
      const maxWidth = (safeWidth - GRID_GAP * (cols - 1)) / cols;
      const maxHeight = (safeHeight - GRID_GAP * (rows - 1)) / rows;
      const size = Math.min(maxWidth, maxHeight);
      if (size > bestSize) {
        bestSize = size;
        bestCols = cols;
      }
    }

    const nextSize = Number.isFinite(bestSize) && bestSize > 0 ? Math.floor(bestSize) : MIN_CARD_SIZE;
    return {
      cols: bestCols,
      size: Math.max(1, nextSize),
    };
  }, []);

  useLayoutEffect(() => {
    if (showEmptyState) return;
    const el = gridRef.current;
    if (!el) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        setGridLayout(computeLayout(rect.width, rect.height, displayCards));
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [computeLayout, displayCards, showEmptyState]);

  const gridStyle = useMemo<React.CSSProperties>(() => ({
    gridTemplateColumns: `repeat(${gridLayout.cols}, ${gridLayout.size}px)`,
    gridAutoRows: `${gridLayout.size}px`,
    gap: `${GRID_GAP}px`,
    justifyContent: 'center',
    alignContent: 'center',
  }), [gridLayout]);

  const renderGrid = (children: React.ReactNode) => (
    <div ref={gridRef} className="flex-1 min-h-0 w-full">
      <div className="grid w-full h-full" style={gridStyle}>
        {children}
      </div>
    </div>
  );

  if (showEmptyState) {
    return (
      <div className="flex-1 h-full min-h-0 flex flex-col items-center justify-center text-gray-500 bg-dark-surface/30 rounded-2xl border-2 border-dashed border-dark-border">
        <Image className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-sm text-gray-400">生成结果会显示在这里</p>
        <p className="mt-2 text-xs text-gray-600">在下方输入提示词后点击“生成”开始</p>
      </div>
    );
  }

  if (hasSlots) {
    const successImages = slots
      .filter((s): s is Extract<ImageGridSlot, { status: 'success' }> => s.status === 'success')
      .map((s) => s.image);

    let successIndex = -1;

    return renderGrid(
      <>
        {slots.map((slot) => {
          if (slot.status === 'pending') {
            return (
              <div
                key={slot.id}
                className="w-full h-full bg-dark-surface rounded-xl border border-dark-border animate-pulse flex items-center justify-center"
              >
                <Sparkles className="text-banana-500/30 w-12 h-12 animate-pulse" />
              </div>
            );
          }

          if (slot.status === 'error') {
            return (
              <div
                key={slot.id}
                className="w-full h-full bg-dark-surface/30 rounded-xl border border-red-500/40 flex flex-col items-center justify-center p-4 text-center"
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
              className="group relative w-full h-full bg-black rounded-xl overflow-hidden border border-dark-border shadow-xl cursor-pointer hover:border-banana-500/50 transition-all duration-200"
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
      </>
    );
  }

  return renderGrid(
    <>
      {!hasSlots && isGenerating && remainingCards > 0 && (
        // Simple Skeleton
        Array.from({ length: remainingCards }).map((_, i) => (
          <div key={i} className="w-full h-full bg-dark-surface rounded-xl border border-dark-border animate-pulse flex items-center justify-center">
            <Sparkles className="text-banana-500/30 w-12 h-12 animate-pulse" />
          </div>
        ))
      )}
      {images.map((img, idx) => (
        <div
          key={img.id}
          role="button"
          tabIndex={0}
          className="group relative w-full h-full bg-black rounded-xl overflow-hidden border border-dark-border shadow-xl cursor-pointer hover:border-banana-500/50 transition-all duration-200"
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
    </>
  );
};
