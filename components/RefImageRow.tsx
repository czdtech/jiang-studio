import React from 'react';
import { ImagePlus, X } from 'lucide-react';

interface RefImageRowProps {
  images: string[];
  maxImages: number;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
}

export const RefImageRow: React.FC<RefImageRowProps> = ({ images, maxImages, onFileUpload, onRemove }) => {
  return (
    <div className="aurora-ref-row">
      <label className="aurora-ref-add">
        <ImagePlus className="w-4 h-4" />
        <span>添加</span>
        <input type="file" className="hidden" accept="image/*" multiple onChange={onFileUpload} />
      </label>
      <div className="aurora-ref-count">{images.length}/{maxImages}</div>
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

