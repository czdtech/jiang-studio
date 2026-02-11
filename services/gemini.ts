/**
 * Gemini 官方 SDK 实现
 */
import { GoogleGenAI, setDefaultBaseUrls } from '@google/genai';
import { GenerationParams, GeneratedImage, ModelType, ImageGenerationOutcome } from '../types';
import {
  cleanBase64,
  createGeneratedImage,
  runWithConcurrency,
  createTimeoutSignal,
  isRetriableError,
  MAX_CONCURRENCY,
  REQUEST_TIMEOUT_MS,
  GeminiResponse,
  GeminiPart,
  ImageConfig,
  createAbortError,
  throwIfAborted,
} from './shared';
import { debugLog } from './logger';

/** Gemini 设置 */
export interface GeminiSettings {
  apiKey: string;
  baseUrl?: string;
}

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

/** 获取 Gemini 客户端 */
const getClient = (settings: GeminiSettings): GoogleGenAI => {
  // 注意：setDefaultBaseUrls 是全局设置；切换供应商/反代时需要显式写回默认值，避免"粘住"上一次的 baseUrl。
  const baseUrl = (settings.baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/$/, '');
  setDefaultBaseUrls({ geminiUrl: baseUrl });
  return new GoogleGenAI({ apiKey: settings.apiKey || '' });
};

/** 构建请求内容 */
const buildContentParts = (params: GenerationParams): GeminiPart[] => {
  const parts: GeminiPart[] = [];

  if (params.referenceImages && params.referenceImages.length > 0) {
    for (const imgData of params.referenceImages) {
      parts.push({
        inlineData: {
          data: cleanBase64(imgData),
          mimeType: 'image/png',
        },
      });
    }
    parts.push({ text: `Generate an image based on these references: ${params.prompt}` });
  } else {
    parts.push({ text: params.prompt });
  }

  return parts;
};

/** 构建图像配置 */
const buildImageConfig = (params: GenerationParams): ImageConfig => {
  const config: ImageConfig = {
    aspectRatio: params.aspectRatio,
  };

  // Pro 模型或自定义模型支持 imageSize
  if (params.model !== ModelType.NANO_BANANA && params.imageSize) {
    config.imageSize = params.imageSize;
  }

  return config;
};

/** 从响应中提取图像 */
const extractImageFromResponse = (
  response: GeminiResponse,
  params: GenerationParams
): GeneratedImage | null => {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) return null;

  for (const part of parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || 'image/png';
      const base64 = `data:${mimeType};base64,${part.inlineData.data}`;
      return createGeneratedImage(base64, params);
    }
  }

  return null;
};

/** 单次生成（带超时） */
const generateSingle = async (
  params: GenerationParams,
  settings: GeminiSettings,
  signal?: AbortSignal
): Promise<GeneratedImage> => {
  throwIfAborted(signal);

  const { signal: timedSignal, cleanup, didTimeout } = createTimeoutSignal(signal, REQUEST_TIMEOUT_MS);

  try {
    const ai = getClient(settings);
    const parts = buildContentParts(params);
    const imageConfig = buildImageConfig(params);

    const request = ai.models.generateContent({
      model: params.model,
      contents: { parts },
      config: { imageConfig },
    });
    // 挂空 catch 避免潜在的 unhandled rejection
    request.catch(() => {});

    const response = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        if (timedSignal.aborted) {
          return reject(didTimeout() ? new Error('请求超时') : createAbortError());
        }
        timedSignal.addEventListener('abort', () => {
          reject(didTimeout() ? new Error('请求超时') : createAbortError());
        }, { once: true });
      }),
    ]);

    const image = extractImageFromResponse(response as GeminiResponse, params);
    if (image) return image;

    debugLog('Gemini Response:', JSON.stringify(response, null, 2));
    throw new Error('No image in Gemini response. Check browser console.');
  } catch (e) {
    if (didTimeout()) throw new Error('请求超时');
    throw e;
  } finally {
    cleanup();
  }
};

/** 批量生成图像（带重试） */
export const generateImages = async (
  params: GenerationParams,
  settings: GeminiSettings,
  options?: { signal?: AbortSignal }
): Promise<ImageGenerationOutcome[]> => {
  const signal = options?.signal;
  const formatError = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const maxAttemptsPerImage = 2; // 失败后再重试 1 次

  const tasks = Array.from({ length: params.count }, (_, index) => async () => {
    if (signal?.aborted) {
      return { index, outcome: { ok: false, error: '已停止' } as const };
    }

    let lastErr: string | null = null;
    for (let attempt = 0; attempt < maxAttemptsPerImage; attempt++) {
      try {
        if (signal?.aborted) throw createAbortError();
        const image = await generateSingle(params, settings, signal);
        return { index, outcome: { ok: true, image } as const };
      } catch (e) {
        lastErr = formatError(e);
        if ((e as any)?.name === 'AbortError' || signal?.aborted) {
          return { index, outcome: { ok: false, error: '已停止' } as const };
        }
        if (attempt < maxAttemptsPerImage - 1 && lastErr && isRetriableError(lastErr, signal?.aborted)) {
          const is429 = /\b429\b/.test(lastErr);
          await new Promise((r) => setTimeout(r, is429 ? 3000 : 300));
        } else {
          break;
        }
      }
    }

    return {
      index,
      outcome: { ok: false, error: lastErr || 'Unknown error' } as const,
    };
  });

  const results = await runWithConcurrency(tasks, MAX_CONCURRENCY, signal);
  const outcomes: ImageGenerationOutcome[] = Array.from(
    { length: params.count },
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

/** 上传图像到 File API 并返回 URI（用于多次编辑优化） */
export const uploadImageFile = async (
  base64Image: string,
  settings: GeminiSettings
): Promise<{ uri: string; name: string }> => {
  const ai = getClient(settings);
  
  // 将 base64 转换为 Blob
  const base64Data = cleanBase64(base64Image);
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'image/png' });
  
  // 上传文件
  const file = await ai.files.upload({
    file: blob,
    config: { 
      mimeType: 'image/png',
      displayName: `edit-source-${Date.now()}`
    }
  });
  
  return { uri: file.uri, name: file.name };
};

/** 删除上传的文件 */
export const deleteImageFile = async (
  fileName: string,
  settings: GeminiSettings
): Promise<void> => {
  try {
    const ai = getClient(settings);
    await ai.files.delete({ name: fileName });
  } catch (e) {
    console.warn('Failed to delete file:', e);
  }
};

/** 编辑图像（支持 File URI 或 inline data） */
export const editImage = async (
  sourceImage: string,
  instruction: string,
  model: ModelType,
  settings: GeminiSettings,
  prevParams?: GenerationParams,
  options?: { fileUri?: string; fileName?: string }
): Promise<GeneratedImage> => {
  const ai = getClient(settings);

  // 优先使用 File URI（节省 token），否则使用 inline data
  const parts: GeminiPart[] = options?.fileUri
    ? [
        {
          fileData: {
            fileUri: options.fileUri,
            mimeType: 'image/png',
          },
        },
        { text: instruction },
      ]
    : [
        {
          inlineData: {
            data: cleanBase64(sourceImage),
            mimeType: 'image/png',
          },
        },
        { text: instruction },
      ];

  const aspectRatio = prevParams?.aspectRatio || '1:1';
  const imageSize = prevParams?.imageSize || '1K';

  const imageConfig: ImageConfig = { aspectRatio };
  if (model !== ModelType.NANO_BANANA && imageSize) {
    imageConfig.imageSize = imageSize;
  }

  const response = await ai.models.generateContent({
    model: model,
    contents: { parts },
    config: { imageConfig },
  });

  const editParams: GenerationParams = {
    prompt: instruction,
    aspectRatio,
    imageSize,
    count: 1,
    model,
  };

  const image = extractImageFromResponse(response as GeminiResponse, editParams);
  if (image) return image;

  throw new Error('Editing failed to produce an image.');
};

/** 优化 Prompt */
export const optimizePrompt = async (
  prompt: string,
  settings: GeminiSettings,
  model: 'gemini-2.5-flash' | 'gemini-3-flash-preview' = 'gemini-2.5-flash'
): Promise<string> => {
  try {
    const ai = getClient(settings);
    const response = await ai.models.generateContent({
      model: model,
      contents: `You are an expert prompt engineer for AI image generation. 
      Rewrite the following prompt to be more descriptive, detailed, and optimized for high-quality generation. 
      Keep the core intent but enhance lighting, texture, and style details.
      Return ONLY the optimized prompt text.
      
      Original Prompt: ${prompt}`,
    });
    return (response as GeminiResponse).text?.trim() || prompt;
  } catch (error) {
    console.error('Prompt optimization failed:', error);
    return prompt;
  }
};
