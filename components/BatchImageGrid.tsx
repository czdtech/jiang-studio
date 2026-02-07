import React, { useMemo } from 'react';
import { AlertTriangle, Download, Edit, Sparkles, Check } from 'lucide-react';
import { BatchTask, GeneratedImage } from '../types';
import { ImageInfoPopover } from './ImageInfoPopover';

interface BatchImageGridProps {
  tasks: BatchTask[];
  countPerPrompt: number;
  selectedImageIds: string[];
  onToggleSelect: (imageId: string) => void;
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
  /** 迭代回调（点击图片迭代按钮时触发） */
  onIterate?: (image: GeneratedImage, index: number, allImages: GeneratedImage[]) => void;
}

export const BatchImageGrid: React.FC<BatchImageGridProps> = ({
  tasks,
  countPerPrompt,
  selectedImageIds,
  onToggleSelect,
  onImageClick,
  onEdit,
  onIterate,
}) => {
  const columns = Math.min(4, Math.max(1, countPerPrompt));
  const gap = 12;
  // 整行居中：36px(角标) + 12px(行gap) + 图片区域宽度
  // 以 8 列为基准计算宽度，使图片保持紧凑
  // 图片列宽 = (父容器宽 - 48px行开销 - 7*12px列间距) / 8 = (100% - 132px) / 8
  const rowMaxWidth = `calc(48px + (100% - 132px) / 8 * ${columns} + ${gap * (columns - 1)}px)`;
  const orderedImages = useMemo(
    () => tasks.flatMap((t) => t.images || []),
    [tasks]
  );

  const rowOffsets = useMemo(() => {
    let offset = 0;
    return tasks.map((t) => {
      const start = offset;
      offset += (t.images || []).length;
      return start;
    });
  }, [tasks]);

  if (tasks.length === 0) return null;

  return (
    <div className="aurora-batch-grid">
      {tasks.map((task, rowIdx) => {
        const images = task.images || [];
        const baseIndex = rowOffsets[rowIdx] ?? 0;
        const placeholders = Math.max(0, countPerPrompt - images.length);
        const showError = task.status === 'error' || !!task.error;
        const errorMessage = task.error || '生成失败';

        return (
          <div key={task.id} className="aurora-batch-row" style={{ maxWidth: rowMaxWidth, margin: '0 auto' }}>
            <div className="aurora-batch-row-index" aria-label={`提示词 ${rowIdx + 1}`}>
              {rowIdx + 1}
            </div>
            <div
              className="aurora-batch-row-grid"
              style={{
                ['--batch-cols' as unknown as string]: columns,
              } as React.CSSProperties}
            >
              {images.map((img, imgIdx) => {
                const isSelected = selectedImageIds.includes(img.id);
                return (
                <div
                  key={img.id}
                  className="relative group"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-nano-ref-image', img.base64);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className={`aurora-batch-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => onImageClick(orderedImages, baseIndex + imgIdx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onImageClick(orderedImages, baseIndex + imgIdx);
                      }
                    }}
                  >
                    <img src={img.base64} alt={img.prompt} draggable={false} className="aurora-batch-card-image" />
                    <button
                      type="button"
                      aria-label={isSelected ? '取消选中图片' : '选中图片'}
                      aria-pressed={isSelected}
                      className={`aurora-batch-select ${isSelected ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(img.id);
                      }}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  <div className="absolute inset-x-0 bottom-2 flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(img);
                      }}
                      aria-label="编辑图片"
                      className="h-7 w-7 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-banana-500 transition-colors flex items-center justify-center"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    {onIterate && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onIterate(img, baseIndex + imgIdx, orderedImages);
                        }}
                        aria-label="迭代此图片"
                        className="h-7 w-7 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-banana-500 transition-colors flex items-center justify-center"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <a
                      href={img.base64}
                      download={`nano-banana-${img.id}.png`}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="下载图片"
                      className="h-7 w-7 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  </div>
                  <ImageInfoPopover image={img} />
                </div>
              );
              })}

              {Array.from({ length: placeholders }).map((_, idx) =>
                showError ? (
                  <div key={`error-${idx}`} className="aurora-batch-card aurora-batch-card-error">
                    <AlertTriangle className="w-8 h-8 text-red-400/80 mb-2" />
                    <p className="text-xs font-semibold text-red-200">生成失败</p>
                    <p className="text-[10px] text-red-200/70 mt-1 line-clamp-3">{errorMessage}</p>
                  </div>
                ) : (
                  <div key={`pending-${idx}`} className="aurora-batch-card aurora-batch-card-pending">
                    <Sparkles className="text-banana-500/30 w-10 h-10 animate-pulse" />
                  </div>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
