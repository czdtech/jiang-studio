import React from 'react';
import { Sparkles, Edit, Download, Image, AlertTriangle } from 'lucide-react';
import { GeneratedImage, GenerationParams } from '../types';
import { ImageInfoPopover } from './ImageInfoPopover';

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

const GRID_GAP = 12;
const MAX_COLUMNS = 4;

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

  const columns = Math.min(MAX_COLUMNS, Math.max(1, displayCards));
  const fullWidth = columns === MAX_COLUMNS;
  const shrinkWidth = `calc((100% - ${GRID_GAP * 3}px) / ${MAX_COLUMNS} * ${columns} + ${GRID_GAP}px * ${columns - 1})`;
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gap: `${GRID_GAP}px`,
    alignItems: 'start',
    width: '100%',
    maxWidth: fullWidth ? '100%' : shrinkWidth,
    marginRight: 'auto',
  };

  const renderGrid = (children: React.ReactNode) => (
    <div className="flex-1 min-h-0 w-full">
      <div className="grid w-full" style={gridStyle}>
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
                className="w-full aspect-square bg-dark-surface rounded-xl border border-dark-border animate-pulse flex items-center justify-center"
              >
                <Sparkles className="text-banana-500/30 w-12 h-12 animate-pulse" />
              </div>
            );
          }

          if (slot.status === 'error') {
            return (
              <div
                key={slot.id}
                className="w-full aspect-square bg-dark-surface/30 rounded-xl border border-red-500/40 flex flex-col items-center justify-center p-4 text-center"
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
              className="relative w-full h-full group"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-nano-ref-image', img.base64);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <div
                role="button"
                tabIndex={0}
                className="relative w-full overflow-hidden rounded-[var(--radius-lg)] cursor-pointer transition-opacity duration-200 hover:opacity-90"
                onClick={() => onImageClick(successImages, idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onImageClick(successImages, idx);
                  }
                }}
              >
                <img src={img.base64} alt={img.prompt} draggable={false} className="w-full h-auto block" />

                <div className="absolute inset-x-0 bottom-2 flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(img); }}
                    aria-label="编辑图片"
                    className="h-8 w-8 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-banana-500 transition-colors flex items-center justify-center"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <a
                    href={img.base64}
                    download={`nano-banana-${img.id}.png`}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="下载图片"
                    className="h-8 w-8 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              </div>
              <ImageInfoPopover image={img} />
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
          <div key={i} className="w-full aspect-square bg-dark-surface rounded-xl border border-dark-border animate-pulse flex items-center justify-center">
            <Sparkles className="text-banana-500/30 w-12 h-12 animate-pulse" />
          </div>
        ))
      )}
      {images.map((img, idx) => (
        <div
          key={img.id}
          className="relative w-full h-full group"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-nano-ref-image', img.base64);
            e.dataTransfer.effectAllowed = 'copy';
          }}
        >
          <div
            role="button"
            tabIndex={0}
            className="relative w-full overflow-hidden rounded-[var(--radius-lg)] cursor-pointer transition-opacity duration-200 hover:opacity-90"
            onClick={() => onImageClick(images, idx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onImageClick(images, idx);
              }
            }}
          >
            <img src={img.base64} alt={img.prompt} draggable={false} className="w-full h-auto block" />

            <div className="absolute inset-x-0 bottom-2 flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(img); }}
                aria-label="编辑图片"
                className="h-8 w-8 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-banana-500 transition-colors flex items-center justify-center"
              >
                <Edit className="w-4 h-4" />
              </button>
              <a
                href={img.base64}
                download={`nano-banana-${img.id}.png`}
                onClick={(e) => e.stopPropagation()}
                aria-label="下载图片"
                className="h-8 w-8 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          </div>
          <ImageInfoPopover image={img} />
        </div>
      ))}
    </>
  );
};
