import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { GeneratedImage } from '../types';
import { getPortfolio } from '../services/db';

interface PortfolioPickerProps {
  onPick: (base64: string) => void;
  onClose: () => void;
}

const MAX_DISPLAY = 30;

export const PortfolioPicker: React.FC<PortfolioPickerProps> = ({ onPick, onClose }) => {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getPortfolio().then((all) => {
      if (cancelled) return;
      // 已按 timestamp desc 排序，取最新 30 张
      setImages(all.slice(0, MAX_DISPLAY));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="absolute bottom-full left-0 mb-2 w-72 bg-graphite border border-ash rounded-[var(--radius-md)] p-3 shadow-[var(--shadow-floating)] z-20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-muted">从作品集选择</span>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-20 text-xs text-text-muted">加载中...</div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-20 text-text-muted">
          <ImageIcon className="w-8 h-8 opacity-20 mb-1" />
          <span className="text-xs">作品集为空</span>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-1.5 max-h-48 overflow-y-auto">
          {images.map((img) => (
            <button
              key={img.id}
              type="button"
              className="aspect-square rounded-[var(--radius-sm)] overflow-hidden border border-ash hover:border-banana-500 transition-colors cursor-pointer"
              onClick={() => onPick(img.base64)}
              title={img.prompt}
            >
              <img
                src={img.base64}
                alt={img.prompt}
                className="w-full h-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
