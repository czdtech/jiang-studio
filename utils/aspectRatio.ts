/**
 * 宽高比工具函数
 * 统一处理 "16:9" 等比例字符串的解析、CSS 值生成和图片尺寸测量
 */

/** 解析 "16:9" 为数值比（width/height），auto 或无效返回 null */
export const parseAspectRatio = (ratio?: string): number | null => {
  if (!ratio || ratio === 'auto') return null;
  const parts = ratio.split(':').map((p) => Number(p));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || parts[1] === 0) return null;
  return parts[0] / parts[1];
};

/** 返回 CSS aspect-ratio 值（如 "16 / 9"），auto 或无效返回 null */
export const getAspectRatioCSS = (ratio?: string): string | null => {
  if (!ratio || ratio === 'auto') return null;
  const parts = ratio.split(':').map((p) => Number(p));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || parts[1] === 0) return null;
  return `${parts[0]} / ${parts[1]}`;
};

/** 解码 base64/dataURL 图片并读取真实宽高 */
export const measureImageDimensions = (src: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
