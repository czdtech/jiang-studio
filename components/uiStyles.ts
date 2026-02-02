/**
 * 共享的 UI 样式常量和工具函数
 */

/**
 * 生成按钮的样式类名
 */
export function getGenerateButtonStyles(canGenerate: boolean, isGenerating: boolean): string {
  const baseStyles = 'w-full h-full min-h-[80px] rounded-xl font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer';
  
  if (!canGenerate && !isGenerating) {
    return `${baseStyles} bg-dark-bg text-gray-500 cursor-not-allowed border border-dark-border opacity-60`;
  }
  
  if (isGenerating) {
    return `${baseStyles} bg-red-500 hover:bg-red-400 text-black`;
  }
  
  return `${baseStyles} bg-banana-500 hover:bg-banana-400 text-black shadow-lg shadow-banana-500/20`;
}

/**
 * 输入框基础样式
 */
export const inputBaseStyles = 'w-full h-9 text-sm bg-dark-bg border border-dark-border rounded-lg px-3 text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-banana-500';

/**
 * 文本区域基础样式
 */
export const textareaBaseStyles = 'flex-1 min-h-[120px] md:min-h-[140px] resize-none text-base leading-relaxed bg-dark-bg border border-dark-border rounded-xl p-4 text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-banana-500';

/**
 * 选择框基础样式
 */
export const selectBaseStyles = 'w-full h-9 text-sm bg-dark-bg border border-dark-border rounded-lg px-3 text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer';

/**
 * 选择框小尺寸样式（用于参数区）
 */
export const selectSmallStyles = 'w-full h-8 text-xs bg-dark-bg border border-dark-border rounded-lg px-2 pr-6 text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer appearance-none';

/**
 * 数量选择按钮样式
 */
export function getCountButtonStyles(isActive: boolean): string {
  return isActive
    ? 'h-8 text-xs rounded-lg border transition-colors bg-banana-500/10 border-banana-500/30 text-banana-400'
    : 'h-8 text-xs rounded-lg border transition-colors bg-dark-bg border-dark-border text-gray-300 hover:bg-dark-border';
}

/**
 * 收藏按钮样式
 */
export function getFavoriteButtonStyles(isFavorite: boolean): string {
  return isFavorite
    ? 'h-8 w-8 flex items-center justify-center rounded-lg border transition-colors border-banana-500/70 bg-banana-500/10 text-banana-400'
    : 'h-8 w-8 flex items-center justify-center rounded-lg border transition-colors border-dark-border bg-dark-bg text-gray-400 hover:text-white hover:border-gray-600';
}

/**
 * 参考图按钮样式
 */
export function getRefImageButtonStyles(hasImages: boolean): string {
  return hasImages
    ? 'h-8 px-3 flex items-center gap-1.5 rounded-lg border transition-colors bg-banana-500/10 border-banana-500/30 text-banana-400'
    : 'h-8 px-3 flex items-center gap-1.5 rounded-lg border transition-colors bg-dark-bg border-dark-border text-gray-400 hover:text-white hover:border-gray-600';
}
