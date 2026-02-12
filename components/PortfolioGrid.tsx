import React, { useEffect, useMemo, useState } from 'react';
import { History, Edit, Trash2, FolderOpen, X as XIcon, ShieldAlert, ChevronDown } from 'lucide-react';
import { GeneratedImage } from '../types';
import {
  clearGalleryDirectoryHandle,
  clearAllLocalData,
  getGalleryDirectoryHandle,
  setGalleryDirectoryHandle,
} from '../services/db';
import { useToast } from './Toast';
import { useAspectRatio } from '../hooks/useAspectRatio';

interface PortfolioGridProps {
  images: GeneratedImage[];
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
  onDelete: (id: string) => void;
}

interface PortfolioImageCardProps {
  img: GeneratedImage;
  idx: number;
  sortedImages: GeneratedImage[];
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
  onDelete: (id: string) => void;
}

/** 作品集图片卡片 */
const PortfolioImageCard: React.FC<PortfolioImageCardProps> = ({
  img,
  idx,
  sortedImages,
  onImageClick,
  onEdit,
  onDelete,
}) => {
  const aspectRatio = useAspectRatio(img.id, img.base64, img.params?.aspectRatio);

  return (
    <div
      role="button"
      tabIndex={0}
      className="bg-dark-surface/60 backdrop-blur-sm rounded-xl overflow-hidden border border-dark-border hover:border-banana-500/50 transition-all duration-200 group cursor-pointer break-inside-avoid"
      style={{ marginBottom: '16px' }}
      onClick={() => onImageClick(sortedImages, idx)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onImageClick(sortedImages, idx);
        }
      }}
    >
      <div className="bg-black relative" style={aspectRatio ? { aspectRatio } : undefined}>
        <img src={img.base64} alt="作品" className="w-full h-auto block" />
        <div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 md:invisible md:group-hover:opacity-100 md:group-hover:visible transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(img); }}
            className="p-2 bg-black/50 hover:bg-banana-500 hover:text-black text-white rounded-full backdrop-blur-sm"
            title="编辑"
            aria-label="编辑"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('确认删除这张图片？')) {
                onDelete(img.id);
              }
            }}
            className="p-2 bg-black/50 hover:bg-red-500 text-white rounded-full backdrop-blur-sm"
            title="删除"
            aria-label="删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="p-3">
        <p className="text-xs text-gray-400 line-clamp-1">{img.prompt}</p>
        <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500">
          <span>{new Date(img.timestamp).toLocaleDateString()}</span>
          <span className="uppercase bg-dark-bg px-1 rounded">{img.params.imageSize || 'STD'}</span>
        </div>
      </div>
    </div>
  );
};

/** 瀑布流容器 */
const PortfolioMasonry = ({
  images: sortedImages,
  allImages,
  onImageClick,
  onEdit,
  onDelete,
}: {
  images: GeneratedImage[];
  allImages: GeneratedImage[];
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
  onDelete: (id: string) => void;
}) => {
  if (allImages.length === 0) {
    return (
      <div className="py-20 text-center text-gray-500">
        作品集还没有图片，先去生成几张吧
      </div>
    );
  }

  return (
    <div className="w-full aurora-portfolio-masonry">
      {sortedImages.map((img, idx) => (
        <PortfolioImageCard
          key={img.id}
          img={img}
          idx={idx}
          sortedImages={sortedImages}
          onImageClick={onImageClick}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};

export const PortfolioGrid = ({
  images,
  onImageClick,
  onEdit,
  onDelete
}: PortfolioGridProps) => {
  const { showToast } = useToast();
  const [galleryDirName, setGalleryDirName] = useState<string>('');
  const [gallerySupported, setGallerySupported] = useState<boolean>(false);
  const [galleryPermission, setGalleryPermission] = useState<PermissionState | 'unknown'>('unknown');
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [displayCount, setDisplayCount] = useState(20);

  // 排序和分页逻辑
  const sortedImages = useMemo(() => {
    const sorted = [...images].sort((a, b) =>
      sortOrder === 'newest'
        ? b.timestamp - a.timestamp
        : a.timestamp - b.timestamp
    );
    return sorted.slice(0, displayCount);
  }, [images, sortOrder, displayCount]);

  useEffect(() => {
    setGallerySupported(typeof (window as any).showDirectoryPicker === 'function');
    void (async () => {
      const handle = await getGalleryDirectoryHandle();
      setGalleryDirName(handle?.name || '');

      if (handle && typeof (handle as any).queryPermission === 'function') {
        try {
          const state = await (handle as any).queryPermission({ mode: 'readwrite' });
          setGalleryPermission(state as PermissionState);
        } catch {
          setGalleryPermission('unknown');
        }
      } else {
        setGalleryPermission(handle ? 'granted' : 'unknown');
      }
    })();
  }, []);

  const handlePickGalleryDir = async () => {
    if (typeof (window as any).showDirectoryPicker !== 'function') {
      alert('当前浏览器不支持选择目录（File System Access API）。请使用 Chrome/Edge 并在 localhost/https 下打开。');
      return;
    }

    try {
      const handle = (await (window as any).showDirectoryPicker()) as FileSystemDirectoryHandle;
      await setGalleryDirectoryHandle(handle);
      setGalleryDirName(handle.name || '图库目录');
      setGalleryPermission('granted');
    } catch (e) {
      // user cancelled or permission denied
      console.warn('Directory picker cancelled/failed:', e);
    }
  };

  const handleRequestPermission = async () => {
    const handle = await getGalleryDirectoryHandle();
    if (!handle) return;
    if (typeof (handle as any).requestPermission !== 'function') {
      showToast('当前浏览器不支持重新授权；请尝试重新选择目录', 'info');
      return;
    }
    setIsRequestingPermission(true);
    try {
      const state = await (handle as any).requestPermission({ mode: 'readwrite' });
      setGalleryPermission(state as PermissionState);
      if (state === 'granted') {
        showToast('已授权：后续生成会自动落盘', 'success');
      } else {
        showToast('未授予写入权限，仍会回退到 IndexedDB', 'info');
      }
    } catch (e) {
      showToast('授权失败：' + (e instanceof Error ? e.message : 'Unknown'), 'error');
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const handleClearGalleryDir = async () => {
    await clearGalleryDirectoryHandle();
    setGalleryDirName('');
    setGalleryPermission('unknown');
  };

  const galleryStatusMessage = (() => {
    if (galleryDirName) {
      if (galleryPermission !== 'granted') {
        return (
          <p className="text-xs text-gray-500">
            已选择目录，但当前未授予写入权限（浏览器重启/刷新后常见）；点击右上角&quot;重新授权&quot;后才会自动落盘，未授权时仅保存缩略图。
          </p>
        );
      }
      return (
        <p className="text-xs text-gray-500">
          落盘存储已启用：原图保存到该目录，浏览器仅保留缩略图索引。
        </p>
      );
    }
    if (gallerySupported) {
      return (
        <p className="text-xs text-yellow-500/80">
          ⚠ 未设置图库目录 — 当前仅保留缩略图，原图不会被保存。可在此选择目录，或在生成时会自动引导设置。
        </p>
      );
    }
    return (
      <p className="text-xs text-gray-500">
        目录选择需要 Chrome/Edge 且在安全上下文（localhost 或 https）下打开；通过局域网 HTTP 访问时通常不可用。
      </p>
    );
  })();

  const handleClearAllLocalData = async () => {
    if (isClearing) return;
    if (!confirm('确认清空本地数据？这会删除浏览器里保存的 API Key、供应商配置、草稿、作品集图片等。')) return;
    if (!confirm('最后确认：清空后无法恢复，且需要刷新页面才能生效。继续吗？')) return;
    setIsClearing(true);
    try {
      await clearAllLocalData();
      showToast('已清空本地数据，即将刷新页面', 'success');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      showToast('清空失败：' + (e instanceof Error ? e.message : 'Unknown'), 'error');
      setIsClearing(false);
    }
  };

  return (
    <div className="aurora-page overflow-y-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <History className="w-6 h-6 text-banana-500" /> 作品历史
          </h2>
          <span className="text-sm text-gray-500">({images.length} 张)</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleClearAllLocalData}
            disabled={isClearing}
            className="px-3 py-2 rounded-lg border text-sm font-medium transition-colors bg-dark-surface border-dark-border text-gray-300 hover:border-red-500/60 hover:text-white disabled:opacity-60"
            title="清空浏览器本地保存的数据（API Key/供应商/作品集等）"
          >
            {isClearing ? '清空中…' : '清空本地数据'}
          </button>

          {/* 排序下拉 */}
          <div className="relative">
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
              className="appearance-none bg-dark-surface border border-dark-border rounded-lg px-3 py-2 pr-8 text-sm text-gray-300 cursor-pointer hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-banana-500 focus:border-banana-500 transition-colors"
            >
              <option value="newest">最新优先</option>
              <option value="oldest">最旧优先</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
          </div>

          {galleryDirName ? (
            <div className="flex items-center gap-1">
              {/* 点击可重新选择目录 */}
              <button
                onClick={handlePickGalleryDir}
                className="flex items-center gap-2 bg-dark-surface border border-dark-border rounded-lg px-3 py-2 text-gray-300 hover:border-banana-500/60 hover:text-white transition-colors cursor-pointer"
                title={`当前图库目录：${galleryDirName}\n点击更换目录`}
              >
                <FolderOpen className="w-4 h-4 text-banana-500/70" />
                <span className="text-xs max-w-[240px] truncate">{galleryDirName}</span>
              </button>

              {gallerySupported && galleryPermission !== 'granted' && (
                <button
                  onClick={handleRequestPermission}
                  disabled={isRequestingPermission}
                  className="flex items-center gap-1 px-2 py-2 rounded-lg border border-banana-500/40 text-banana-300 hover:border-banana-500/70 hover:text-banana-200 text-[11px] disabled:opacity-60"
                  title="重新授权写入权限（需要一次点击）"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {isRequestingPermission ? '授权中…' : '授权'}
                </button>
              )}

              <button
                onClick={handleClearGalleryDir}
                aria-label="清除图库目录"
                className="p-1.5 rounded-lg hover:bg-dark-border text-gray-500 hover:text-white transition-colors"
                title="清除图库目录"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={handlePickGalleryDir}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                gallerySupported
                  ? 'bg-dark-surface border-dark-border text-gray-300 hover:border-banana-500/60 hover:text-white'
                  : 'bg-dark-surface border-dark-border text-gray-500 cursor-not-allowed'
              }`}
              title={gallerySupported ? '选择一个目录用于保存原图到磁盘' : '浏览器不支持目录选择'}
              disabled={!gallerySupported}
            >
              <FolderOpen className="w-4 h-4" /> 选择图库目录
            </button>
          )}
        </div>
      </div>

{galleryStatusMessage}

      <PortfolioMasonry
        images={sortedImages}
        allImages={images}
        onImageClick={onImageClick}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      {/* 加载更多按钮 */}
      {displayCount < images.length && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => setDisplayCount((c) => c + 20)}
            className="px-6 py-3 bg-dark-surface border border-dark-border rounded-lg text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
          >
            加载更多…（剩余 {images.length - displayCount} 张）
          </button>
        </div>
      )}
    </div>
  );
};
