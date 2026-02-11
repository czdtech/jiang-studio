import React, { useEffect, useState } from 'react';
import { Sparkles, Edit, Download, Image, AlertTriangle } from 'lucide-react';
import { GeneratedImage, GenerationParams } from '../types';
import { ImageInfoPopover } from './ImageInfoPopover';
import { getAspectRatioCSS, measureImageDimensions } from '../utils/aspectRatio';

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
  maxColumns?: number;
  minColumns?: number;
  gap?: number;
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
  /** 迭代回调（点击图片迭代按钮时触发） */
  onIterate?: (image: GeneratedImage, index: number, allImages: GeneratedImage[]) => void;
}

const GRID_GAP = 12;
const MAX_COLUMNS = 4;

/** 缓存已测量的图片真实宽高比（以 id 为 key，避免 base64 占用大量内存） */
const MAX_RATIO_CACHE = 200;
const measuredRatioCache = new Map<string, string>();

const setCachedRatio = (key: string, value: string) => {
  if (measuredRatioCache.size >= MAX_RATIO_CACHE) {
    const firstKey = measuredRatioCache.keys().next().value;
    if (firstKey !== undefined) measuredRatioCache.delete(firstKey);
  }
  measuredRatioCache.set(key, value);
};

/** 获取图片的 aspect-ratio CSS 值：优先用 params，auto 时测量 */
const useResolvedAspectRatio = (id: string, src: string, paramsRatio?: string): string | undefined => {
  const known = getAspectRatioCSS(paramsRatio);
  const [measured, setMeasured] = useState<string | undefined>(() => {
    if (known) return known;
    return measuredRatioCache.get(id);
  });

  useEffect(() => {
    if (known) { setMeasured(known); return; }
    const cached = measuredRatioCache.get(id);
    if (cached) { setMeasured(cached); return; }
    let cancelled = false;
    measureImageDimensions(src).then(({ width, height }) => {
      if (cancelled) return;
      const css = `${width} / ${height}`;
      setCachedRatio(id, css);
      setMeasured(css);
    }).catch(() => {
      if (!cancelled) setMeasured('1 / 1');
    });
    return () => { cancelled = true; };
  }, [id, src, known]);

  return measured;
};

interface MasonryImageCardProps {
  img: GeneratedImage;
  idx: number;
  allImages: GeneratedImage[];
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
  onIterate?: (image: GeneratedImage, index: number, allImages: GeneratedImage[]) => void;
}

/** 图片卡片：带测量占位的 img */
const MasonryImageCard: React.FC<MasonryImageCardProps> = ({
  img,
  idx,
  allImages,
  onImageClick,
  onEdit,
  onIterate,
}) => {
  const aspectRatio = useResolvedAspectRatio(img.id, img.base64, img.params?.aspectRatio);

  return (
    <div
      className="relative w-full group break-inside-avoid"
      style={{ marginBottom: 'var(--masonry-gap)' }}
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
        style={aspectRatio ? { aspectRatio } : undefined}
        onClick={() => onImageClick(allImages, idx)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onImageClick(allImages, idx);
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
          {onIterate && (
            <button
              onClick={(e) => { e.stopPropagation(); onIterate(img, idx, allImages); }}
              aria-label="迭代此图片"
              className="h-8 w-8 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-banana-500 transition-colors flex items-center justify-center"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          )}
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
};

export const ImageGrid = ({
  images,
  slots,
  isGenerating,
  params,
  expectedCount,
  maxColumns = MAX_COLUMNS,
  minColumns = 2,
  gap = GRID_GAP,
  onImageClick,
  onEdit,
  onIterate,
}: ImageGridProps) => {
  const hasSlots = !!slots && slots.length > 0;
  const showEmptyState = !hasSlots && images.length === 0 && !isGenerating;
  const totalCards = hasSlots ? slots.length : (isGenerating ? (expectedCount ?? params.count) : images.length);
  const displayCards = Math.max(totalCards, 1);
  const remainingCards = Math.max(totalCards - images.length, 0);

  const columns = Math.min(maxColumns, Math.max(minColumns, displayCards));
  const fullWidth = columns === maxColumns;
  const shrinkWidth = `calc((100% - ${gap * (maxColumns - 1)}px) / ${maxColumns} * ${columns} + ${gap}px * ${columns - 1})`;

  // 占位符的 aspect-ratio：优先从 params 解析，auto 时回退 1:1
  const placeholderAspectRatio = getAspectRatioCSS(params.aspectRatio) || '1 / 1';

  const masonryStyle: React.CSSProperties = {
    columnCount: columns,
    columnGap: `${gap}px`,
    width: '100%',
    maxWidth: fullWidth ? '100%' : shrinkWidth,
    margin: '0 auto',
    ['--masonry-gap' as string]: `${gap}px`,
  };

  const renderMasonry = (children: React.ReactNode) => (
    <div className="flex-1 min-h-0 w-full">
      <div style={masonryStyle}>
        {children}
      </div>
    </div>
  );

  if (showEmptyState) {
    return (
      <div className="flex-1 h-full min-h-0 flex flex-col items-center justify-center text-gray-500 bg-dark-surface/30 rounded-2xl border-2 border-dashed border-dark-border">
        <Image className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-sm text-gray-400">生成结果会显示在这里</p>
        <p className="mt-2 text-xs text-gray-600">在下方输入提示词后点击"生成"开始</p>
      </div>
    );
  }

  if (hasSlots) {
    const successImages = slots
      .filter((s): s is Extract<ImageGridSlot, { status: 'success' }> => s.status === 'success')
      .map((s) => s.image);

    let successIndex = -1;

    return renderMasonry(
      <>
        {slots.map((slot) => {
          if (slot.status === 'pending') {
            return (
              <div
                key={slot.id}
                className="w-full bg-dark-surface rounded-xl border border-dark-border animate-pulse flex items-center justify-center break-inside-avoid"
                style={{ aspectRatio: placeholderAspectRatio, marginBottom: `${gap}px` }}
              >
                <Sparkles className="text-banana-500/30 w-12 h-12 animate-pulse" />
              </div>
            );
          }

          if (slot.status === 'error') {
            return (
              <div
                key={slot.id}
                className="w-full bg-dark-surface/30 rounded-xl border border-red-500/40 flex flex-col items-center justify-center p-4 text-center break-inside-avoid"
                style={{ aspectRatio: placeholderAspectRatio, marginBottom: `${gap}px` }}
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
            <MasonryImageCard
              key={slot.id}
              img={img}
              idx={idx}
              allImages={successImages}
              onImageClick={onImageClick}
              onEdit={onEdit}
              onIterate={onIterate}
            />
          );
        })}
      </>
    );
  }

  return renderMasonry(
    <>
      {!hasSlots && isGenerating && remainingCards > 0 && (
        Array.from({ length: remainingCards }).map((_, i) => (
          <div
            key={i}
            className="w-full bg-dark-surface rounded-xl border border-dark-border animate-pulse flex items-center justify-center break-inside-avoid"
            style={{ aspectRatio: placeholderAspectRatio, marginBottom: `${gap}px` }}
          >
            <Sparkles className="text-banana-500/30 w-12 h-12 animate-pulse" />
          </div>
        ))
      )}
      {images.map((img, idx) => (
        <MasonryImageCard
          key={img.id}
          img={img}
          idx={idx}
          allImages={images}
          onImageClick={onImageClick}
          onEdit={onEdit}
          onIterate={onIterate}
        />
      ))}
    </>
  );
};
