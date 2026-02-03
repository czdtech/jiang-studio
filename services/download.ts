import type { GeneratedImage } from '../types';

export const inferImageExtFromDataUrl = (dataUrl: string): string => {
  const match = dataUrl.match(/^data:image\/([^;]+);base64,/i);
  if (!match) return 'png';

  const mime = (match[1] || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'png';
};

const sanitizeFileName = (name: string): string => {
  // Windows/macOS 兼容：替换掉非法字符
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim();
};

export const downloadDataUrl = (dataUrl: string, filename: string): void => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = sanitizeFileName(filename);
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

export const buildBatchDownloadName = (img: GeneratedImage, index: number, total: number): string => {
  if (img.fileName && img.fileName.trim()) return sanitizeFileName(img.fileName);
  const ext = inferImageExtFromDataUrl(img.base64);
  const digits = Math.max(2, String(Math.max(1, total)).length);
  const order = String(index + 1).padStart(digits, '0');
  return `nano-banana-batch-${order}-${img.id}.${ext}`;
};

export const downloadImagesSequentially = async (
  images: GeneratedImage[],
  options?: { delayMs?: number }
): Promise<number> => {
  const delayMs = Math.max(0, Math.floor(options?.delayMs ?? 120));
  const unique = Array.from(
    new Map(images.map((img) => [img.id, img])).values()
  );

  for (let i = 0; i < unique.length; i++) {
    const img = unique[i];
    downloadDataUrl(img.base64, buildBatchDownloadName(img, i, unique.length));
    if (delayMs > 0) await new Promise((r) => window.setTimeout(r, delayMs));
  }

  return unique.length;
};

