/**
 * 共享工具函数和类型定义
 */
import { GenerationParams, GeneratedImage } from '../types';
import { debugLog } from './logger';

// ============ 类型定义 ============

/** Gemini SDK 响应结构 */
export interface GeminiPart {
  text?: string;
  inlineData?: {
    data: string;
    mimeType: string;
  };
  fileData?: {
    fileUri: string;
    mimeType: string;
  };
}

export interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
  text?: string;
}

/** OpenAI 兼容 API 响应结构 */
export interface OpenAIImageUrl {
  url?: string;
  b64_json?: string;
}

export interface OpenAIContentPart {
  type: string;
  text?: string;
  image_url?: OpenAIImageUrl;
  data?: string;
}

export interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[];
}

export interface OpenAIChoice {
  message?: OpenAIMessage;
  delta?: {
    content?: string;
    image_url?: OpenAIImageUrl;
    image?: string;
  };
  finish_reason?: string;
}

export interface OpenAIResponse {
  choices?: OpenAIChoice[];
  data?: Array<{ b64_json?: string; url?: string }>;
  _imageData?: string; // 流式响应提取的图像数据
}

/** 图像配置 */
export interface ImageConfig {
  aspectRatio?: string;
  imageSize?: string;
}

/** 生成结果（内部使用，可能带 URL 标记） */
export interface InternalGeneratedImage extends GeneratedImage {
  _isUrl?: boolean;
}

// ============ 工具函数 ============

export const createAbortError = (): Error => {
  try {
    // DOMException 在浏览器里更标准（name === 'AbortError'）
    return new DOMException('Aborted', 'AbortError');
  } catch {
    const e = new Error('Aborted');
    (e as any).name = 'AbortError';
    return e;
  }
};

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw createAbortError();
};

/** 清理 base64 前缀 */
export const cleanBase64 = (b64: string): string => {
  return b64.replace(/^data:image\/\w+;base64,/, '');
};

/** 生成唯一 ID */
export const generateId = (): string => {
  return crypto.randomUUID();
};

/** 创建 GeneratedImage 对象 */
export const createGeneratedImage = (
  base64OrUrl: string,
  params: GenerationParams,
  isUrl = false
): InternalGeneratedImage => {
  // 如果是 URL，保持原样；如果是 base64，确保有正确前缀
  let imageData: string;
  if (isUrl || base64OrUrl.startsWith('http')) {
    imageData = base64OrUrl; // URL 保持原样，后续会转换
  } else if (base64OrUrl.startsWith('data:')) {
    imageData = base64OrUrl; // 已有 data URL 前缀
  } else {
    imageData = `data:image/png;base64,${base64OrUrl}`; // 纯 base64，加前缀
  }

  return {
    id: generateId(),
    base64: imageData,
    prompt: params.prompt,
    model: params.model,
    timestamp: Date.now(),
    params,
    ...(isUrl ? { _isUrl: true } : {}),
  };
};

/** URL 转 base64 */
export const urlToBase64 = async (url: string, signal?: AbortSignal): Promise<string> => {
  try {
    throwIfAborted(signal);
    const response = await fetch(url, { signal });
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Failed to convert URL to base64:', e);
    return url;
  }
};

/** 
 * 图像压缩（使用 OffscreenCanvas 如果可用）
 * 
 * 优化策略：
 * 1. 如果支持 OffscreenCanvas，在主线程外处理
 * 2. 二分查找最优质量值，而不是线性递减
 */
export const compressImage = async (
  base64: string,
  maxSizeKB: number = 800
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // 限制最大尺寸
      const maxDim = 1024;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      // 尝试使用 OffscreenCanvas（非阻塞）
      let canvas: HTMLCanvasElement | OffscreenCanvas;
      let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

      if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext('2d');
      } else {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext('2d');
      }

      if (!ctx) {
        resolve(base64);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // 二分查找最优质量
      const maxBytes = maxSizeKB * 1024;
      let low = 0.1;
      let high = 0.9;
      let result: string = '';

      const toDataURL = (q: number): string => {
        if (canvas instanceof OffscreenCanvas) {
          // OffscreenCanvas 不支持 toDataURL，需要转换
          // 这里退回到同步方式，但至少绘制是非阻塞的
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = width;
          tmpCanvas.height = height;
          const tmpCtx = tmpCanvas.getContext('2d');
          if (tmpCtx) {
            tmpCtx.drawImage(img, 0, 0, width, height);
            return tmpCanvas.toDataURL('image/jpeg', q);
          }
          return base64;
        }
        return canvas.toDataURL('image/jpeg', q);
      };

      // 最多 5 次二分
      for (let i = 0; i < 5; i++) {
        const mid = (low + high) / 2;
        result = toDataURL(mid);
        if (result.length > maxBytes) {
          high = mid;
        } else {
          low = mid;
        }
      }

      // 最终使用 low 值（保证在限制内）
      result = toDataURL(low);
      debugLog(
        `Image compressed: ${Math.round(base64.length / 1024)}KB -> ${Math.round(result.length / 1024)}KB (quality: ${low.toFixed(2)})`
      );
      resolve(result);
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
};

/** 并发控制池 */
export const runWithConcurrency = async <T>(
  tasks: (() => Promise<T>)[],
  maxConcurrency: number,
  signal?: AbortSignal
): Promise<T[]> => {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    if (signal?.aborted) break;
    let e: Promise<void>;
    const p = task().then((result) => {
      results.push(result);
    });

    e = p.finally(() => {
      const idx = executing.indexOf(e);
      if (idx >= 0) executing.splice(idx, 1);
    });

    executing.push(e);

    if (executing.length >= maxConcurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
};

/** 聚合错误信息 */
export const aggregateErrors = (errors: Error[]): string => {
  if (errors.length === 0) return 'Unknown error';
  if (errors.length === 1) return errors[0].message;

  // 去重并统计
  const errorCounts = new Map<string, number>();
  for (const err of errors) {
    const msg = err.message;
    errorCounts.set(msg, (errorCounts.get(msg) || 0) + 1);
  }

  const parts: string[] = [];
  for (const [msg, count] of errorCounts) {
    parts.push(count > 1 ? `${msg} (x${count})` : msg);
  }

  return `${errors.length} errors: ${parts.join('; ')}`;
};
