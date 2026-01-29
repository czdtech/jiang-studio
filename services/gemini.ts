/**
 * Gemini 官方 SDK 实现
 */
import { GoogleGenAI, setDefaultBaseUrls } from '@google/genai';
import { GenerationParams, GeneratedImage, ModelType } from '../types';
import {
  cleanBase64,
  createGeneratedImage,
  runWithConcurrency,
  aggregateErrors,
  GeminiResponse,
  GeminiPart,
  ImageConfig,
  createAbortError,
  throwIfAborted,
} from './shared';

const MAX_CONCURRENCY = 2;

/** Gemini 设置 */
export interface GeminiSettings {
  apiKey: string;
  baseUrl?: string;
}

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

/** 获取 Gemini 客户端 */
const getClient = (settings: GeminiSettings): GoogleGenAI => {
  // 注意：setDefaultBaseUrls 是全局设置；切换供应商/反代时需要显式写回默认值，避免“粘住”上一次的 baseUrl。
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

/** 单次生成 */
const generateSingle = async (
  params: GenerationParams,
  settings: GeminiSettings,
  signal?: AbortSignal
): Promise<GeneratedImage> => {
  throwIfAborted(signal);
  const ai = getClient(settings);
  const parts = buildContentParts(params);
  const imageConfig = buildImageConfig(params);

  const request = ai.models.generateContent({
    model: params.model,
    contents: { parts },
    config: { imageConfig },
  });
  // 如果用户点击“停止”，我们会提前返回（Promise.race 走 abort 分支），此时 request 仍可能继续并在之后 reject。
  // 这里挂一个空的 catch 避免潜在的 unhandled rejection（不影响正常 await request 的抛错）。
  if (signal) request.catch(() => {});

  const response = signal
    ? await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          if (signal.aborted) return reject(createAbortError());
          signal.addEventListener('abort', () => reject(createAbortError()), { once: true });
        }),
      ])
    : await request;

  const image = extractImageFromResponse(response as GeminiResponse, params);
  if (image) return image;

  console.log('Gemini Response:', JSON.stringify(response, null, 2));
  throw new Error('No image in Gemini response. Check browser console.');
};

/** 批量生成图像 */
export const generateImages = async (
  params: GenerationParams,
  settings: GeminiSettings,
  options?: { signal?: AbortSignal }
): Promise<GeneratedImage[]> => {
  const signal = options?.signal;
  const errors: Error[] = [];

  const createTask = () => async (): Promise<GeneratedImage | null> => {
    try {
      return await generateSingle(params, settings, signal);
    } catch (e) {
      if ((e as any)?.name === 'AbortError' || signal?.aborted) throw e;
      errors.push(e instanceof Error ? e : new Error(String(e)));
      return null;
    }
  };

  const tasks = Array.from({ length: params.count }, createTask);
  let results: Array<GeneratedImage | null> = [];
  if (signal) {
    const abortPromise: Promise<never> = new Promise((_, reject) => {
      if (signal.aborted) return reject(createAbortError());
      signal.addEventListener('abort', () => reject(createAbortError()), { once: true });
    });
    results = await Promise.race([runWithConcurrency(tasks, MAX_CONCURRENCY, signal), abortPromise]);
  } else {
    results = await runWithConcurrency(tasks, MAX_CONCURRENCY, signal);
  }
  const images = results.filter((r): r is GeneratedImage => r !== null);

  if (images.length === 0 && params.count > 0) {
    throw new Error(aggregateErrors(errors));
  }

  return images;
};

/** 编辑图像 */
export const editImage = async (
  sourceImage: string,
  instruction: string,
  model: ModelType,
  settings: GeminiSettings,
  prevParams?: GenerationParams
): Promise<GeneratedImage> => {
  const ai = getClient(settings);

  const parts: GeminiPart[] = [
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
  settings: GeminiSettings
): Promise<string> => {
  try {
    const ai = getClient(settings);
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash',
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
