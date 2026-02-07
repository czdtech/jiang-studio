import React, { useCallback, useRef, useState } from 'react';
import { ImagePlus, FolderOpen, X } from 'lucide-react';
import { PortfolioPicker } from './PortfolioPicker';

interface RefImageRowProps {
  images: string[];
  maxImages: number;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  onAddImages: (dataUrls: string[]) => void;
}

export const RefImageRow: React.FC<RefImageRowProps> = ({
  images,
  maxImages,
  onFileUpload,
  onRemove,
  onAddImages,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const portfolioTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-nano-ref-image')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const data = e.dataTransfer.getData('application/x-nano-ref-image');
      if (data) {
        onAddImages([data]);
      }
    },
    [onAddImages]
  );

  const handlePortfolioPick = useCallback(
    (base64: string) => {
      const idx = images.indexOf(base64);
      if (idx >= 0) {
        onRemove(idx);
      } else {
        onAddImages([base64]);
      }
    },
    [images, onRemove, onAddImages]
  );

  return (
    <div
      className={`aurora-ref-row ${isDragOver ? 'ring-2 ring-banana-500/60 rounded-lg' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <label className="aurora-ref-add">
        <ImagePlus className="w-4 h-4" />
        <span>本地上传</span>
        <input type="file" className="hidden" accept="image/*" multiple onChange={onFileUpload} />
      </label>
      <div
        className="relative"
        onMouseEnter={() => {
          if (portfolioTimerRef.current) {
            clearTimeout(portfolioTimerRef.current);
            portfolioTimerRef.current = undefined;
          }
          setShowPortfolio(true);
        }}
        onMouseLeave={() => {
          portfolioTimerRef.current = setTimeout(() => {
            setShowPortfolio(false);
          }, 250);
        }}
      >
        <button
          type="button"
          className="aurora-ref-add"
          onClick={() => setShowPortfolio((v) => !v)}
          title="从作品集选择"
        >
          <FolderOpen className="w-4 h-4" />
          <span>作品集</span>
        </button>
        {showPortfolio && (
          <PortfolioPicker
            selectedImages={images}
            onPick={handlePortfolioPick}
            onClose={() => setShowPortfolio(false)}
          />
        )}
      </div>
      <div className="aurora-ref-count">
        {images.length}/{maxImages}
      </div>
      <div className="aurora-ref-list">
        {images.map((img, idx) => (
          <div key={idx} className="aurora-ref-thumb">
            <img src={img} alt={`Ref ${idx + 1}`} />
            <button
              type="button"
              className="aurora-ref-remove"
              onClick={() => onRemove(idx)}
              aria-label="移除参考图"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
