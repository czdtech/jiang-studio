/**
 * Aurora Design System - 共享的 UI 样式常量和工具函数
 */

/**
 * 生成按钮的样式类名 - Aurora 渐变主按钮
 */
export function getGenerateButtonStyles(canGenerate: boolean, isGenerating: boolean): string {
  const baseStyles = 'w-full h-full min-h-[80px] rounded-[var(--radius-lg)] font-semibold flex flex-col items-center justify-center gap-1 transition-all duration-200 cursor-pointer';

  if (!canGenerate && !isGenerating) {
    return `${baseStyles} bg-slate border border-ash text-text-disabled cursor-not-allowed opacity-60`;
  }

  if (isGenerating) {
    return `${baseStyles} bg-error hover:bg-red-400 text-obsidian`;
  }

  return `${baseStyles} bg-gradient-to-br from-banana-500 to-banana-600 hover:from-banana-400 hover:to-banana-500 text-obsidian shadow-[var(--shadow-glow)]`;
}

/**
 * 输入框基础样式 - Aurora Slate 背景 + Ash 边框
 */
export const inputBaseStyles = 'w-full h-9 text-sm bg-slate border border-ash rounded-[var(--radius-md)] px-3 text-text-primary placeholder-text-muted outline-none focus:ring-2 focus:ring-banana-500/30 focus:border-banana-500 transition-all duration-200';

/**
 * 文本区域基础样式 - Aurora 设计
 */
export const textareaBaseStyles = 'flex-1 min-h-[120px] md:min-h-[140px] resize-none text-base leading-relaxed bg-slate border border-ash rounded-[var(--radius-lg)] p-4 text-text-primary placeholder-text-muted outline-none focus:ring-2 focus:ring-banana-500/30 focus:border-banana-500 transition-all duration-200';

/**
 * 选择框基础样式 - Aurora 设计
 */
export const selectBaseStyles = 'w-full h-9 text-sm bg-slate border border-ash rounded-[var(--radius-md)] px-3 text-text-primary outline-none focus:ring-2 focus:ring-banana-500/30 focus:border-banana-500 cursor-pointer transition-all duration-200';

/**
 * 选择框小尺寸样式（用于参数区）- Aurora 设计
 */
export const selectSmallStyles = 'w-full h-8 text-xs bg-slate border border-ash rounded-[var(--radius-md)] px-2 pr-6 text-text-primary outline-none focus:ring-2 focus:ring-banana-500/30 focus:border-banana-500 cursor-pointer appearance-none transition-all duration-200';

/**
 * 数量选择按钮样式 - Aurora 设计
 */
export function getCountButtonStyles(isActive: boolean): string {
  return isActive
    ? 'h-8 text-xs rounded-[var(--radius-md)] border transition-all duration-200 bg-banana-500/15 border-banana-500/40 text-banana-400 shadow-[var(--shadow-glow)]'
    : 'h-8 text-xs rounded-[var(--radius-md)] border transition-all duration-200 bg-slate border-ash text-text-secondary hover:bg-graphite hover:border-smoke';
}

/**
 * 收藏按钮样式 - Aurora 设计
 */
export function getFavoriteButtonStyles(isFavorite: boolean): string {
  return isFavorite
    ? 'h-8 w-8 flex items-center justify-center rounded-[var(--radius-md)] border transition-all duration-200 border-banana-500/70 bg-banana-500/15 text-banana-400 shadow-[var(--shadow-glow)]'
    : 'h-8 w-8 flex items-center justify-center rounded-[var(--radius-md)] border transition-all duration-200 border-ash bg-slate text-text-muted hover:text-text-primary hover:border-smoke hover:bg-graphite';
}

/**
 * 参考图按钮样式 - Aurora 设计
 */
export function getRefImageButtonStyles(hasImages: boolean): string {
  return hasImages
    ? 'h-8 px-3 flex items-center gap-1.5 rounded-[var(--radius-md)] border transition-all duration-200 bg-banana-500/15 border-banana-500/40 text-banana-400'
    : 'h-8 px-3 flex items-center gap-1.5 rounded-[var(--radius-md)] border transition-all duration-200 bg-slate border-ash text-text-muted hover:text-text-primary hover:border-smoke hover:bg-graphite';
}
