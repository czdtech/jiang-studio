/**
 * 共享工具函数和类型定义
 */
import { GenerationParams, GeneratedImage, ImageGenerationOutcome, ProviderProfile } from '../types';
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
  /** 人物生成安全策略（Antigravity / Gemini） */
  personGeneration?: string;
}

/** 生成结果（内部使用，可能带 URL 标记） */
export interface InternalGeneratedImage extends GeneratedImage {
  _isUrl?: boolean;
}

// ============ 并发控制常量 ============

/** 单提示词多图并发数（峰值：MAX_BATCH_CONCURRENCY 8 × 4 = 32 并行请求） */
export const MAX_CONCURRENCY = 4;

/** 单请求超时（毫秒） */
export const REQUEST_TIMEOUT_MS = 120_000;

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

export const isAbortError = (e: unknown): boolean =>
  (e instanceof Error && e.name === 'AbortError') ||
  (e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError');

/** 将错误转为字符串（供日志/用户展示） */
export const formatError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 拼接 baseUrl 与 path，自动去除 baseUrl 尾部斜杠 */
export const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/$/, '')}${path}`;

/**
 * 开发模式下通过 Vite CORS 代理转发外部请求。
 * 将 https://api.example.com/path 转为 /cors-proxy/https%3A%2F%2Fapi.example.com%2Fpath
 * 生产模式下直接返回原 URL（纯静态部署无代理）。
 */
const proxyUrl = (url: string): string => {
  if (import.meta.env.DEV && url.startsWith('http')) {
    return `/cors-proxy/${encodeURIComponent(url)}`;
  }
  return url;
};

/** 清理 base64 前缀 */
export const cleanBase64 = (b64: string): string => {
  return b64.replace(/^data:image\/\w+;base64,/, '');
};

/** 生成唯一 ID */
export const generateId = (): string => {
  return crypto.randomUUID();
};

/** 为供应商生成唯一名称（同 scope 内不重复） */
export const getUniqueProviderName = (
  baseName: string,
  existingProviders: ProviderProfile[],
  excludeId?: string
): string => {
  const names = new Set(
    existingProviders
      .filter((p) => !excludeId || p.id !== excludeId)
      .map((p) => p.name.trim())
  );
  if (!names.has(baseName)) return baseName;
  let n = 2;
  while (names.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
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

/** 将多个文件读取为 data URL 数组 */
export function readFilesAsDataUrls(files: File[]): Promise<string[]> {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error('Failed to read file'));
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        })
    )
  );
}

/** URL 转 base64 */
export const urlToBase64 = async (url: string, signal?: AbortSignal): Promise<string> => {
  try {
    throwIfAborted(signal);
    const response = await fetch(proxyUrl(url), { signal });
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

/** 处理可能是 URL 的图像，转换为 base64 */
export const finalizeImage = async (
  image: InternalGeneratedImage,
  signal?: AbortSignal
): Promise<GeneratedImage> => {
  if (image._isUrl || (!image.base64.startsWith('data:') && image.base64.startsWith('http'))) {
    debugLog('Converting image URL to base64:', image.base64);
    image.base64 = await urlToBase64(image.base64, signal);
    delete image._isUrl;
  }
  return image;
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

/** 创建带超时的 AbortSignal（同时监听外部 signal 和超时） */
export const createTimeoutSignal = (signal?: AbortSignal, timeoutMs?: number) => {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal, cleanup: () => {}, didTimeout: () => false };
  }

  let timedOut = false;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    },
    didTimeout: () => timedOut,
  };
};

/** 带超时的 fetch，统一处理 abort 和超时 */
export const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<Response> => {
  throwIfAborted(signal);
  const { signal: timedSignal, cleanup, didTimeout } = createTimeoutSignal(signal, timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(proxyUrl(url), { ...init, signal: timedSignal });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }
    return response;
  } catch (error) {
    if (didTimeout()) throw new Error('请求超时');
    throw error;
  } finally {
    cleanup();
  }
};

/** 判断错误是否值得重试（通用） */
export const isRetriableError = (message: string, aborted?: boolean): boolean => {
  if (aborted) return false;
  // 明确不重试的错误类型
  if (/aborted|已停止|cancelled/i.test(message)) return false;
  if (/请求超时|timeout|timed?\s*out/i.test(message)) return false;
  if (/No image in|empty response|任务失败|failed to produce/i.test(message)) return false;
  // 从错误消息中提取 HTTP 状态码
  const m = message.match(/(?:API|Kie API)\s+error\s+(\d{3})/i) || message.match(/\berror\s+(\d{3})\b/i);
  if (!m) return true; // 未知网络错误等通常值得重试
  const status = Number(m[1]);
  // 4xx 基本都是请求/鉴权问题（除了 429 限流），重试意义不大
  if (status >= 400 && status < 500 && status !== 429) return false;
  return true;
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

/** 429 限流时延长退避时间 */
export const is429Error = (message: string): boolean => /\b429\b/.test(message);

/**
 * 批量图像生成（带重试、并发控制、abort 处理）
 * 供 gemini、openai、kie 复用
 */
export const runBatchImageGeneration = async (
  count: number,
  generateOne: (signal?: AbortSignal) => Promise<GeneratedImage>,
  options?: { signal?: AbortSignal }
): Promise<ImageGenerationOutcome[]> => {
  const signal = options?.signal;
  const maxAttemptsPerImage = 2;

  const tasks = Array.from({ length: count }, (_, index) => async () => {
    if (signal?.aborted) return { index, outcome: { ok: false, error: '已停止' } as const };

    let lastErr: string | null = null;
    for (let attempt = 0; attempt < maxAttemptsPerImage; attempt++) {
      try {
        if (signal?.aborted) throw createAbortError();
        const image = await generateOne(signal);
        return { index, outcome: { ok: true, image } as const };
      } catch (e) {
        lastErr = formatError(e);
        if (isAbortError(e) || signal?.aborted) {
          return { index, outcome: { ok: false, error: '已停止' } as const };
        }
        if (attempt < maxAttemptsPerImage - 1 && lastErr && isRetriableError(lastErr, signal?.aborted)) {
          await new Promise((r) => setTimeout(r, is429Error(lastErr) ? 3000 : 300));
        } else {
          break;
        }
      }
    }
    return { index, outcome: { ok: false, error: lastErr || 'Unknown error' } as const };
  });

  const results = await runWithConcurrency(tasks, MAX_CONCURRENCY, signal);
  const outcomes: ImageGenerationOutcome[] = Array.from(
    { length: count },
    () => ({ ok: false, error: 'Unknown error' }) as const
  );
  for (const r of results) outcomes[r.index] = r.outcome;
  if (signal?.aborted) {
    for (let i = 0; i < outcomes.length; i++) {
      const o = outcomes[i];
      if (o.ok === false && o.error === 'Unknown error') {
        outcomes[i] = { ok: false, error: '已停止' } as const;
      }
    }
  }
  return outcomes;
};

/**
 * OpenAI 兼容的 Prompt 优化（/v1/chat/completions）
 * 供 openai、kie 等使用同一优化端点的供应商复用
 */
export const optimizePromptOpenAICompat = async (
  prompt: string,
  settings: { apiKey: string; baseUrl: string },
  model: string
): Promise<string> => {
  if (!model || !model.trim()) {
    throw new Error('请先设置提示词优化模型');
  }

  const url = joinUrl(settings.baseUrl, '/v1/chat/completions');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: model.trim(),
      messages: [
        {
          role: 'system',
          content:
            'You are an expert prompt engineer for AI image generation. Rewrite prompts to be more descriptive, detailed, and optimized for high-quality generation. Keep the core intent but enhance lighting, texture, and style details. Return ONLY the optimized prompt text.',
        },
        { role: 'user', content: `Original Prompt: ${prompt}` },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const optimized = data.choices?.[0]?.message?.content?.trim();
  if (!optimized) throw new Error('No response from optimization model');
  return optimized;
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
