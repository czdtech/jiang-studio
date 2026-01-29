import React, { useEffect, useState } from 'react';
import { History, Edit, Trash2, FolderOpen, X as XIcon, ShieldAlert } from 'lucide-react';
import { GeneratedImage } from '../types';
import {
  clearGalleryDirectoryHandle,
  getGalleryDirectoryHandle,
  setGalleryDirectoryHandle,
} from '../services/db';
import { useToast } from './Toast';

interface PortfolioGridProps {
  images: GeneratedImage[];
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
  onDelete: (id: string) => void;
}

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <History className="w-6 h-6 text-banana-500" /> Creation History
        </h2>

        <div className="flex items-center gap-2">
          {galleryDirName ? (
            <div className="flex items-center gap-2 bg-dark-surface border border-dark-border rounded-lg px-3 py-2">
              <FolderOpen className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-300 max-w-[240px] truncate">{galleryDirName}</span>

              {gallerySupported && galleryPermission !== 'granted' && (
                <button
                  onClick={handleRequestPermission}
                  disabled={isRequestingPermission}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-banana-500/40 text-banana-300 hover:border-banana-500/70 hover:text-banana-200 text-[11px] disabled:opacity-60"
                  title="重新授权写入权限（需要一次点击）"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {isRequestingPermission ? '授权中…' : '重新授权'}
                </button>
              )}

              <button
                onClick={handleClearGalleryDir}
                className="p-1 rounded hover:bg-dark-border text-gray-400 hover:text-white"
                title="清除图库目录"
              >
                <XIcon className="w-4 h-4" />
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

	      {galleryDirName ? (
	        galleryPermission !== 'granted' ? (
	          <p className="text-xs text-gray-500">
	            已选择目录，但当前未授予写入权限（浏览器重启/刷新后常见）；点击右上角“重新授权”后才会自动落盘，否则会回退到 IndexedDB。
	          </p>
	        ) : (
	          <p className="text-xs text-gray-500">
	            已启用“落盘存储”：新生成图片会优先保存原图到该目录，IndexedDB 仅保存缩略图与文件句柄（更省配额）。
	          </p>
	        )
	      ) : gallerySupported ? (
	        <p className="text-xs text-gray-500">
	          建议选择一个目录用于保存原图到磁盘；未选择时将回退保存到 IndexedDB（会占用浏览器配额）。
	        </p>
      ) : (
        <p className="text-xs text-gray-500">
          目录选择需要 Chrome/Edge 且在安全上下文（localhost 或 https）下打开；通过局域网 HTTP 访问时通常不可用。
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {images.map((img, idx) => (
          <div
            key={img.id}
            className="bg-dark-surface rounded-xl overflow-hidden border border-dark-border hover:border-banana-500/50 transition-all group cursor-zoom-in"
            onClick={() => onImageClick(images, idx)}
          >
            <div className="aspect-square bg-black relative">
              <img src={img.base64} alt="portfolio" className="w-full h-full object-cover" />
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(img); }}
                  className="p-2 bg-black/50 hover:bg-banana-500 hover:text-black text-white rounded-full backdrop-blur-sm"
                  title="Edit"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete image?')) {
                      onDelete(img.id);
                    }
                  }}
                  className="p-2 bg-black/50 hover:bg-red-500 text-white rounded-full backdrop-blur-sm"
                  title="Delete"
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
        ))}
        {images.length === 0 && (
          <div className="col-span-full py-20 text-center text-gray-500">
            No images in portfolio yet. Start generating!
          </div>
        )}
      </div>
    </div>
  );
};
