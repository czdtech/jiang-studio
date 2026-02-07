import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X, Check } from 'lucide-react';
import { GeneratedImage } from '../types';
import { getPortfolio } from '../services/db';

interface PortfolioPickerProps {
  onPick: (base64: string) => void;
  onClose: () => void;
  /** 当前已选中的参考图（base64），用于展示选中态和 toggle 行为 */
  selectedImages?: string[];
}

const MAX_DISPLAY = 30;
/** 鼠标移出后延迟关闭的毫秒数，避免跨间隙移动误触 */
const CLOSE_DELAY_MS = 200;

export const PortfolioPicker: React.FC<PortfolioPickerProps> = ({ onPick, onClose, selectedImages }) => {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleMouseEnter = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    closeTimerRef.current = setTimeout(onClose, CLOSE_DELAY_MS);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void getPortfolio().then((all) => {
      if (cancelled) return;
      // 已按 timestamp desc 排序，取最新 30 张
      setImages(all.slice(0, MAX_DISPLAY));
      setLoading(false);
    });
    return () => {
      cancelled = true;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  return (
    <div
      className="absolute bottom-full left-0 mb-2 w-72 bg-graphite border border-ash rounded-[var(--radius-md)] p-3 shadow-[var(--shadow-floating)] z-20"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
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
          {images.map((img) => {
            const isSelected = selectedImages?.includes(img.base64) ?? false;
            return (
              <button
                key={img.id}
                type="button"
                className={`relative aspect-square rounded-[var(--radius-sm)] overflow-hidden border-2 transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-banana-500 ring-1 ring-banana-500/30'
                    : 'border-ash hover:border-banana-500'
                }`}
                onClick={() => onPick(img.base64)}
                title={img.prompt}
              >
                <img
                  src={img.base64}
                  alt={img.prompt}
                  className={`w-full h-full object-cover transition-opacity ${isSelected ? 'opacity-75' : ''}`}
                  draggable={false}
                />
                {isSelected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-banana-500/20">
                    <div className="w-5 h-5 rounded-full bg-banana-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-void" />
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
