/**
 * OpenAI 兼容 API 实现
 */
import { GenerationParams, GeneratedImage, ImageGenerationOutcome, ModelType } from '../types';
import {
  cleanBase64,
  compressImage,
  createAbortError,
  createGeneratedImage,
  fetchWithTimeout,
  finalizeImage,
  ImageConfig,
  joinUrl,
  InternalGeneratedImage,
  OpenAIChoice,
  OpenAIContentPart,
  OpenAIMessage,
  OpenAIResponse,
  REQUEST_TIMEOUT_MS,
  runBatchImageGeneration,
  throwIfAborted,
} from './shared';
import { debugLog } from './logger';
import { parseAspectRatio } from '../utils/aspectRatio';
import { parseModelNameForImageParams } from '../utils/modelNameParams';

/** 从文本中提取图像 data URL/链接 */
const extractImageFromText = (text: string): string | null => {
  if (!text) return null;

  // 1) 直接 data URL（或包含在文本中的 data URL）
  const dataUrlMatch = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
  if (dataUrlMatch) return dataUrlMatch[0];

  // 2) Markdown 图片（data URL）
  const mdDataUrlMatch = text.match(/!\[[^\]]*?\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\)/);
  if (mdDataUrlMatch) return mdDataUrlMatch[1];

  // 3) Markdown 图片（普通 URL）
  const mdUrlMatch = text.match(/!\[[^\]]*?\]\((https?:\/\/[^\s)]+)\)/);
  if (mdUrlMatch) return mdUrlMatch[1];

  // 4) 纯 URL（很多中转会直接返回图片 URL）
  const urlMatch = text.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/i);
  if (urlMatch) return urlMatch[0];

  // 4) 纯 base64（没有前缀）
  if (text.match(/^[A-Za-z0-9+/=]{1000,}$/)) return text;

  return null;
};

/** OpenAI 兼容设置 */
export interface OpenAISettings {
  apiKey: string;
  baseUrl: string;
}

/** 构建消息内容 */
const buildMessageContent = (params: GenerationParams): OpenAIContentPart[] => {
  const content: OpenAIContentPart[] = [];

  if (params.referenceImages && params.referenceImages.length > 0) {
    for (const imgData of params.referenceImages) {
      content.push({
        type: 'image_url',
        image_url: { url: imgData },
      });
    }
    content.push({
      type: 'text',
      text: `Generate an image based on these references: ${params.prompt}`,
    });
  } else {
    content.push({
      type: 'text',
      text: params.prompt,
    });
  }

  return content;
};


/** imageSize → Antigravity quality 参数映射 */
const IMAGE_SIZE_TO_QUALITY: Record<string, string> = { '1K': 'standard', '2K': 'medium', '4K': 'hd' };

/** 比例 × 分辨率 → 精确像素尺寸（对齐 Gemini 3 Pro Image 官方分辨率表） */
const RATIO_SIZE_MAP: Record<string, Record<string, string>> = {
  '1:1':  { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
  '2:3':  { '1K': '848x1264',  '2K': '1696x2528', '4K': '3392x5056' },
  '3:2':  { '1K': '1264x848',  '2K': '2528x1696', '4K': '5056x3392' },
  '3:4':  { '1K': '896x1200',  '2K': '1792x2400', '4K': '3584x4800' },
  '4:3':  { '1K': '1200x896',  '2K': '2400x1792', '4K': '4800x3584' },
  '4:5':  { '1K': '928x1152',  '2K': '1856x2304', '4K': '3712x4608' },
  '5:4':  { '1K': '1152x928',  '2K': '2304x1856', '4K': '4608x3712' },
  '9:16': { '1K': '768x1376',  '2K': '1536x2752', '4K': '3072x5504' },
  '16:9': { '1K': '1376x768',  '2K': '2752x1536', '4K': '5504x3072' },
  '21:9': { '1K': '1584x672',  '2K': '3168x1344', '4K': '6336x2688' },
};

const mapOpenAIImageSize = (imageSize?: string, aspectRatio?: string): string | undefined => {
  if (!imageSize) return undefined;
  if (/^\d+x\d+$/i.test(imageSize)) return imageSize;

  const normalized = imageSize.toUpperCase();
  if (!['1K', '2K', '4K'].includes(normalized)) return imageSize;

  // 优先查精确映射表
  if (aspectRatio && RATIO_SIZE_MAP[aspectRatio]?.[normalized]) {
    return RATIO_SIZE_MAP[aspectRatio][normalized];
  }

  // 回退：按方向粗略估算
  const ratio = parseAspectRatio(aspectRatio);
  const isLandscape = ratio !== null && ratio > 1.05;
  const isPortrait = ratio !== null && ratio < 0.95;

  if (normalized === '1K') {
    if (isPortrait) return '1024x1536';
    if (isLandscape) return '1536x1024';
    return '1024x1024';
  }

  const base = normalized === '2K' ? 2048 : 4096;
  if (isPortrait) return `${base}x${Math.round(base * 1.5)}`;
  if (isLandscape) return `${Math.round(base * 1.5)}x${base}`;
  return `${base}x${base}`;
};

const isInvalidSizeError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error);
  return /不合法的size|invalid\s+size/i.test(msg);
};

const isInvalidResponseFormatError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error);
  return /不合法的response_format|invalid\s+response_format/i.test(msg);
};

const isEndpointUnsupported = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error);
  return /API error (404|405|501)/i.test(msg) || /not\s+found|not\s+supported/i.test(msg);
};

const isUnknownAspectRatioError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error);
  if (!/API error (400|422)/i.test(msg)) return false;
  if (!/aspect_ratio/i.test(msg)) return false;
  return /unknown|unrecognized|unexpected|additional\s+properties|extra|invalid|not\s+allowed|not\s+permitted/i.test(msg);
};

const isGeminiModel = (model: string): boolean => model.toLowerCase().startsWith('gemini-');

const buildGeminiContents = (params: GenerationParams): Array<{ role?: string; parts: Array<Record<string, unknown>> }> => {
  const parts: Array<Record<string, unknown>> = [];

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

  return [{ role: 'user', parts }];
};

/** 从 aspectRatio / imageSize / model / personGeneration 构建 ImageConfig（供生成、编辑等多处复用） */
const buildImageConfig = (
  aspectRatio: string,
  imageSize?: string,
  model?: string,
  personGeneration?: string
): ImageConfig => {
  const config: ImageConfig = { aspectRatio };
  if (model !== ModelType.NANO_BANANA && imageSize) {
    config.imageSize = imageSize;
  }
  if (personGeneration) {
    config.personGeneration = personGeneration;
  }
  return config;
};

/** 根据模型名移除冲突字段，避免与模型内置方向/分辨率冲突 */
const filterImageConfigByModel = (config: ImageConfig, model: string): ImageConfig => {
  const parsed = parseModelNameForImageParams(model);
  if (!parsed.detectedRatio && !parsed.detectedSize) return config;
  const result = { ...config };
  if (parsed.detectedRatio) delete result.aspectRatio;
  if (parsed.detectedSize) delete result.imageSize;
  return result;
};

const buildGeminiImageConfig = (params: GenerationParams): ImageConfig => {
  const raw = buildImageConfig(
    params.aspectRatio,
    params.imageSize,
    params.model,
    params.personGeneration
  );
  return filterImageConfigByModel(raw, params.model);
};

const extractGeminiImageFromResponse = (
  response: { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> } }> },
  params: GenerationParams
): InternalGeneratedImage | null => {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) return null;

  // 1. 优先检查 inlineData（base64 格式，Gemini 官方返回）
  for (const part of parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || 'image/png';
      const base64 = `data:${mimeType};base64,${part.inlineData.data}`;
      return createGeneratedImage(base64, params);
    }
  }

  // 2. 检查 text 部分中的图片 URL（部分第三方中转返回 markdown 图片链接或纯 URL）
  for (const part of parts) {
    if (part.text) {
      const extracted = extractImageFromText(part.text);
      if (extracted) {
        const isUrl = extracted.startsWith('http');
        return createGeneratedImage(extracted, params, isUrl);
      }
    }
  }

  return null;
};

/** 流式请求 OpenAI 兼容 API */
const callStreamingAPI = async (
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: OpenAIContentPart[] }>,
  imageConfig?: ImageConfig,
  signal?: AbortSignal,
  options?: { omitResponseFormat?: boolean }
): Promise<OpenAIResponse> => {
  const url = joinUrl(baseUrl, '/v1/chat/completions');

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 8192,
    stream: true,
  };

  if (imageConfig) {
    if (!options?.omitResponseFormat) {
      body.response_format = { type: 'image' };
    }
    if (imageConfig.aspectRatio) body.aspect_ratio = imageConfig.aspectRatio;
    if (imageConfig.imageSize) {
      body.size = imageConfig.imageSize;
      body.imageSize = imageConfig.imageSize;   // Antigravity v4.1.14+: highest priority
      const quality = IMAGE_SIZE_TO_QUALITY[imageConfig.imageSize.toUpperCase()];
      if (quality) body.quality = quality;
    }
    if (imageConfig.personGeneration) body.person_generation = imageConfig.personGeneration;
  }

  debugLog('Request URL:', url);
  debugLog('Request body:', JSON.stringify(body, null, 2));

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    signal,
    REQUEST_TIMEOUT_MS
  );

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    // 非流式通常直接返回 JSON；这里优先兼容
    try {
      return (await response.clone().json()) as OpenAIResponse;
    } catch {
      // ignore and fallback to SSE parsing
    }
  }

  return parseStreamResponse(response, signal);
};

const callImagesAPI = async (
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  imageConfig?: ImageConfig,
  signal?: AbortSignal
): Promise<OpenAIResponse> => {
  const url = joinUrl(baseUrl, '/v1/images/generations');
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
  };

  if (imageConfig?.imageSize) {
    body.size = imageConfig.imageSize;
    body.imageSize = imageConfig.imageSize;     // Antigravity v4.1.14+: highest priority
    const quality = IMAGE_SIZE_TO_QUALITY[imageConfig.imageSize.toUpperCase()];
    if (quality) body.quality = quality;
  }
  if (imageConfig?.aspectRatio) {
    body.aspect_ratio = imageConfig.aspectRatio;
  }
  if (imageConfig?.personGeneration) {
    body.person_generation = imageConfig.personGeneration;
  }

  debugLog('Images API URL:', url);
  debugLog('Images API body:', JSON.stringify(body, null, 2));

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    signal,
    REQUEST_TIMEOUT_MS
  );
  return (await response.json()) as OpenAIResponse;
};

/** base64 data URL → Blob（用于 multipart/form-data 上传） */
const dataUrlToBlob = (dataUrl: string): Blob => {
  let base64Data: string;
  let mimeType: string;
  if (!dataUrl.startsWith('data:')) {
    base64Data = dataUrl;
    mimeType = 'image/png';
  } else {
    const [header, data] = dataUrl.split(',');
    base64Data = data;
    mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
  }
  const byteString = atob(base64Data);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new Blob([ab], { type: mimeType });
};

/**
 * 调用 /v1/images/edits 端点（Antigravity 图生图）
 * 使用 multipart/form-data 上传参考图 + 文本提示词
 */
const callImagesEditsAPI = async (
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  images: string[],
  imageConfig?: ImageConfig,
  signal?: AbortSignal
): Promise<OpenAIResponse> => {
  const url = joinUrl(baseUrl, '/v1/images/edits');
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('n', '1');

  // 第一张用 'image'（兼容 OpenAI 标准字段），后续用 image2, image3...
  for (let i = 0; i < images.length; i++) {
    const blob = dataUrlToBlob(images[i]);
    const fieldName = i === 0 ? 'image' : `image${i + 1}`;
    formData.append(fieldName, blob, `ref_${i + 1}.png`);
  }

  if (imageConfig?.aspectRatio) {
    formData.append('aspect_ratio', imageConfig.aspectRatio);
  }
  if (imageConfig?.imageSize) {
    formData.append('image_size', imageConfig.imageSize);
  }
  if (imageConfig?.personGeneration) {
    formData.append('person_generation', imageConfig.personGeneration);
  }

  debugLog('Images Edits API URL:', url);

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    },
    signal,
    REQUEST_TIMEOUT_MS
  );
  return (await response.json()) as OpenAIResponse;
};

const callGeminiRelayAPI = async (
  params: GenerationParams,
  settings: OpenAISettings,
  signal?: AbortSignal
): Promise<GeneratedImage> => {
  const url = joinUrl(settings.baseUrl, `/v1beta/models/${params.model}:generateContent`);
  const contents = buildGeminiContents(params);
  const imageConfig = buildGeminiImageConfig(params);
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig,
    },
  };

  debugLog('Gemini Relay URL:', url);
  debugLog('Gemini Relay body:', JSON.stringify(body, null, 2));

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    signal,
    REQUEST_TIMEOUT_MS
  );

  const result = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> } }>;
  };
  const image = extractGeminiImageFromResponse(result, params);
  if (image) return finalizeImage(image, signal);

  debugLog('Gemini Relay Response:', JSON.stringify(result, null, 2));
  throw new Error('No image in Gemini relay response. Check browser console.');
};

const callGeminiChatRelayAPI = async (
  params: GenerationParams,
  settings: OpenAISettings,
  signal?: AbortSignal
): Promise<OpenAIResponse> => {
  const url = joinUrl(settings.baseUrl, '/v1/chat/completions');
  const contents = buildGeminiContents(params);
  const imageConfig = buildGeminiImageConfig(params);
  // messages 使用标准 OpenAI 格式（包含 image_url），确保代理能正确接收参考图
  // contents 使用 Gemini 原生格式，供支持 Gemini 协议的代理使用
  const messageContent = buildMessageContent(params);
  // 映射 imageSize 为 OpenAI 兼容的像素尺寸（如 1K + 3:4 → 1024x1536）
  const mappedSize = imageConfig.imageSize
    ? mapOpenAIImageSize(imageConfig.imageSize, imageConfig.aspectRatio)
    : undefined;
  // 映射 imageSize 为 Antigravity quality 参数（standard=1K, medium=2K, hd=4K）
  const mappedQuality = imageConfig.imageSize ? IMAGE_SIZE_TO_QUALITY[imageConfig.imageSize.toUpperCase()] : undefined;
  const generationConfig = {
    responseModalities: ['IMAGE'],
    imageConfig,
  };
  const body: Record<string, unknown> = {
    model: params.model,
    stream: true,
    max_tokens: 8192,
    messages: [{ role: 'user', content: messageContent }],
    contents,
    // 顶层 generationConfig：大多数 Gemini 中转会读取此字段
    generationConfig,
    // 顶层 OpenAI 风格字段：部分中转通过 aspect_ratio / size / quality 传递参数
    ...(imageConfig.aspectRatio && { aspect_ratio: imageConfig.aspectRatio }),
    ...(mappedSize && { size: mappedSize }),
    ...(mappedQuality && { quality: mappedQuality }),
    ...(imageConfig.imageSize && { imageSize: imageConfig.imageSize }), // Antigravity v4.1.14+: highest priority
    ...(imageConfig.personGeneration && { person_generation: imageConfig.personGeneration }),
    // extra_body：兼容使用 OpenAI Python SDK 的中转
    extra_body: { generationConfig },
  };

  debugLog('Gemini Chat Relay URL:', url);
  debugLog('Gemini Chat Relay body:', JSON.stringify(body, null, 2));

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    signal,
    REQUEST_TIMEOUT_MS
  );

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as OpenAIResponse;
  }

  return parseStreamResponse(response, signal);
};

const requestGeminiChatImage = async (
  params: GenerationParams,
  settings: OpenAISettings,
  signal?: AbortSignal
): Promise<GeneratedImage> => {
  const result = await callGeminiChatRelayAPI(params, settings, signal);
  const image = extractImageFromResponse(result, params);
  if (image) {
    return finalizeImage(image, signal);
  }

  const responseContent = result.choices?.[0]?.message?.content;
  if (responseContent && typeof responseContent === 'string' && responseContent.length > 0) {
    throw new Error(`Gemini chat relay returned text: ${responseContent.substring(0, 120)}`);
  }

  throw new Error('No image in Gemini chat relay response. Check browser console.');
};

/** 解析 SSE 流响应 */
const parseStreamResponse = async (response: Response, signal?: AbortSignal): Promise<OpenAIResponse> => {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let imageData: string | null = null;
  let streamError: string | null = null;

  const processEventData = (data: string) => {
    if (!data || data === '[DONE]') return;

    try {
      const parsed = JSON.parse(data) as { choices?: OpenAIChoice[]; error?: { message?: string } };
      if (parsed.error?.message) {
        streamError = parsed.error.message;
        return;
      }
      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      if (delta?.content) {
        const extracted = extractImageFromText(delta.content);
        if (extracted) {
          imageData = extracted;
        } else {
          fullContent += delta.content;
        }
      }

      if (delta?.image_url?.url) imageData = delta.image_url.url;
      if (delta?.image) imageData = delta.image;

      const finishReason = choice?.finish_reason;
      // 兼容“非流式 JSON”直接返回 message.content 的情况
      const msgContent = choice?.message?.content;
      if (typeof msgContent === 'string' && msgContent) {
        const extracted = extractImageFromText(msgContent);
        if (extracted) imageData = extracted;
        else fullContent += msgContent;
      }

      if (finishReason === 'stop') {
        const finalMsg = choice?.message;
        const extractedFromMessage = extractImageFromMessage(finalMsg);
        if (extractedFromMessage) imageData = extractedFromMessage;

        if (!imageData && fullContent) {
          const extractedFromText = extractImageFromText(fullContent);
          if (extractedFromText) imageData = extractedFromText;
        }
      }
    } catch {
      // 跳过非 JSON
    }
  };

  while (true) {
    if (signal?.aborted) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw createAbortError();
    }

    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      // fetch 被 abort 时，read 也可能抛出异常
      if (signal?.aborted) throw createAbortError();
      throw e;
    }

    const { done, value } = chunk;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');

    // SSE 事件以空行分隔（\n\n）。必须做跨 chunk 缓冲，避免大 payload 被拆分导致 JSON 解析失败。
    while (true) {
      const sepIndex = buffer.indexOf('\n\n');
      if (sepIndex === -1) break;

      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length === 0) continue;
      processEventData(dataLines.join('\n').trim());
    }
  }

  // flush decoder
  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, '\n');

  // 处理尾部残留：可能是最后一个 SSE event 没有以空行结尾；也可能根本不是 SSE（直接 JSON/URL）
  const remaining = buffer.trim();
  if (remaining) {
    const remainingDataLines = remaining
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (remainingDataLines.length > 0) {
      // 这里按“每行一个 JSON chunk”更稳（避免多条 JSON 被 join 成无效 JSON）
      for (const lineData of remainingDataLines) processEventData(lineData.trim());
    } else {
      const extracted = extractImageFromText(remaining);
      if (extracted) imageData = extracted;
      else processEventData(remaining);
    }
  }

  if (streamError) throw new Error(`API stream error: ${streamError}`);

  debugLog('Stream completed. Image found:', !!imageData);

  return {
    choices: [
      {
        message: {
          content: imageData || fullContent,
          role: 'assistant',
        },
        finish_reason: 'stop',
      },
    ],
    _imageData: imageData || undefined,
  };
};

const requestImageResponse = async (
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: OpenAIContentPart[] }>,
  imageConfig?: ImageConfig,
  signal?: AbortSignal
): Promise<OpenAIResponse> => {
  const removeAspectRatio = (cfg?: ImageConfig): ImageConfig | undefined => {
    if (!cfg?.aspectRatio) return cfg;
    const { aspectRatio: _omit, ...rest } = cfg;
    return Object.keys(rest).length > 0 ? rest : undefined;
  };

  const requestOnce = (cfg?: ImageConfig, omitResponseFormat?: boolean) =>
    callStreamingAPI(baseUrl, apiKey, model, messages, cfg, signal, { omitResponseFormat });

  const requestOnceWithAspectFallback = async (cfg?: ImageConfig, omitResponseFormat?: boolean) => {
    try {
      return await requestOnce(cfg, omitResponseFormat);
    } catch (error) {
      if (cfg?.aspectRatio && isUnknownAspectRatioError(error)) {
        return await requestOnce(removeAspectRatio(cfg), omitResponseFormat);
      }
      throw error;
    }
  };

  const requestWithSizeFallback = async (cfg?: ImageConfig, omitResponseFormat?: boolean) => {
    try {
      return await requestOnceWithAspectFallback(cfg, omitResponseFormat);
    } catch (error) {
      if (!cfg?.imageSize || !isInvalidSizeError(error)) {
        throw error;
      }

      const mappedSize = mapOpenAIImageSize(cfg.imageSize, cfg.aspectRatio);
      if (mappedSize && mappedSize !== cfg.imageSize) {
        try {
          return await requestOnceWithAspectFallback({ ...cfg, imageSize: mappedSize }, omitResponseFormat);
        } catch (retryError) {
          if (!isInvalidSizeError(retryError)) throw retryError;
          const { imageSize: _omit, ...rest } = cfg;
          const fallback = Object.keys(rest).length > 0 ? rest : undefined;
          return await requestOnceWithAspectFallback(fallback, omitResponseFormat);
        }
      }

      const { imageSize: _omit, ...rest } = cfg;
      const fallback = Object.keys(rest).length > 0 ? rest : undefined;
      return await requestOnceWithAspectFallback(fallback, omitResponseFormat);
    }
  };

  const extractPromptText = () => {
    const parts: string[] = [];
    for (const msg of messages) {
      const content = msg.content;
      for (const part of content) {
        if (part.type === 'text' && part.text?.trim()) parts.push(part.text.trim());
      }
    }
    return parts.join('\n').trim();
  };

  const hasImageInput = messages.some(
    (msg) =>
      Array.isArray(msg.content) &&
      msg.content.some((part) => part.type === 'image_url' && part.image_url?.url)
  );

  const preferImagesEndpoint = !hasImageInput;

  const requestImagesWithSizeFallback = async (cfg?: ImageConfig) => {
    const promptText = extractPromptText();
    if (!promptText) throw new Error('无法从请求中提取提示词');

    const requestImagesOnce = async (nextCfg?: ImageConfig) => {
      const imageSize = nextCfg?.imageSize
        ? mapOpenAIImageSize(nextCfg.imageSize, nextCfg.aspectRatio) ?? nextCfg.imageSize
        : undefined;
      const finalCfg = imageSize ? { ...nextCfg, imageSize } : nextCfg;
      try {
        return await callImagesAPI(baseUrl, apiKey, model, promptText, finalCfg, signal);
      } catch (error) {
        if (finalCfg?.aspectRatio && isUnknownAspectRatioError(error)) {
          return await callImagesAPI(baseUrl, apiKey, model, promptText, removeAspectRatio(finalCfg), signal);
        }
        throw error;
      }
    };

    try {
      return await requestImagesOnce(cfg);
    } catch (error) {
      if (!cfg?.imageSize || !isInvalidSizeError(error)) throw error;
      const mappedSize = mapOpenAIImageSize(cfg.imageSize, cfg.aspectRatio);
      if (mappedSize && mappedSize !== cfg.imageSize) {
        try {
          return await requestImagesOnce({ ...cfg, imageSize: mappedSize });
        } catch (retryError) {
          if (!isInvalidSizeError(retryError)) throw retryError;
        }
      }
      const { imageSize: _omit, ...rest } = cfg;
      const fallback = Object.keys(rest).length > 0 ? rest : undefined;
      return await requestImagesOnce(fallback);
    }
  };

  if (preferImagesEndpoint) {
    try {
      return await requestImagesWithSizeFallback(imageConfig);
    } catch (error) {
      if (!isEndpointUnsupported(error)) throw error;
    }
  }

  try {
    return await requestWithSizeFallback(imageConfig, false);
  } catch (error) {
    if (!isInvalidResponseFormatError(error)) throw error;
    try {
      return await requestWithSizeFallback(imageConfig, true);
    } catch (retryError) {
      try {
        return await requestWithSizeFallback(undefined, true);
      } catch (fallbackError) {
        if (hasImageInput) throw fallbackError;
        return await requestImagesWithSizeFallback(imageConfig);
      }
    }
  }
};

/** 从消息中提取图像 */
const extractImageFromMessage = (message?: OpenAIMessage): string | null => {
  if (!message?.content) return null;

  const content = message.content;

  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        return part.image_url.url;
      }
      if (part.image_url?.b64_json) {
        return `data:image/png;base64,${part.image_url.b64_json}`;
      }
    }
  }

  if (typeof content === 'string') {
    return extractImageFromText(content);
  }

  return null;
};

/** 从完整响应中提取图像 */
const extractImageFromResponse = (
  result: OpenAIResponse,
  params: GenerationParams
): InternalGeneratedImage | null => {
  // 1. 流式响应提取的图像
  if (result._imageData) {
    return createGeneratedImage(result._imageData, params);
  }

  const messageContent = result.choices?.[0]?.message?.content;

  // 2. 数组格式内容
  if (Array.isArray(messageContent)) {
    for (const part of messageContent as OpenAIContentPart[]) {
      if (part.type === 'image_url' && part.image_url?.url) {
        return createGeneratedImage(part.image_url.url, params);
      }
      if (part.type === 'image' && part.data) {
        return createGeneratedImage(`data:image/png;base64,${part.data}`, params);
      }
      if (part.image_url?.b64_json) {
        return createGeneratedImage(`data:image/png;base64,${part.image_url.b64_json}`, params);
      }
    }
  }

  // 3. OpenAI Images API 格式
  if (result.data?.[0]?.b64_json) {
    return createGeneratedImage(`data:image/png;base64,${result.data[0].b64_json}`, params);
  }
  if (result.data?.[0]?.url) {
    return createGeneratedImage(result.data[0].url, params, true);
  }

  // 4. 字符串格式内容
  if (typeof messageContent === 'string') {
    // data URL
    if (messageContent.startsWith('data:image')) {
      return createGeneratedImage(messageContent, params);
    }

    // Markdown 图片链接（data URL）
    const markdownDataMatch = messageContent.match(/!\[.*?\]\((data:image\/[^\s)]+)\)/);
    if (markdownDataMatch) {
      return createGeneratedImage(markdownDataMatch[1], params);
    }

    // Markdown 图片链接
    const markdownMatch = messageContent.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (markdownMatch) {
      return createGeneratedImage(markdownMatch[1], params, true);
    }

    // 纯 URL
    const urlMatch = messageContent.match(/^(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp))/i);
    if (urlMatch) {
      return createGeneratedImage(urlMatch[1], params, true);
    }

    // 原始 base64
    if (messageContent.match(/^[A-Za-z0-9+/=]{1000,}$/)) {
      return createGeneratedImage(`data:image/png;base64,${messageContent}`, params);
    }
  }

  return null;
};

/** 单次生成 */
const generateSingle = async (
  params: GenerationParams,
  settings: OpenAISettings,
  signal?: AbortSignal,
  imageConfigOverride?: ImageConfig
): Promise<GeneratedImage> => {
  if (isGeminiModel(params.model)) {
    // 优先尝试 Gemini 原生端点（/v1beta/models/:generateContent）
    // 原生端点对 aspectRatio / imageSize 支持最可靠
    try {
      return await callGeminiRelayAPI(params, settings, signal);
    } catch (error) {
      // 用户主动取消时直接抛出，不降级
      if (signal?.aborted) throw error;
      // 其它任何错误（CORS、404、网络问题等）一律降级到 /v1/chat/completions
      debugLog('Gemini native relay failed, falling back to /v1/chat/completions:', error);
    }
    return await requestGeminiChatImage(params, settings, signal);
  }

  const content = buildMessageContent(params);
  const messages = [{ role: 'user', content }];

  const imageConfig: ImageConfig = imageConfigOverride ?? buildGeminiImageConfig(params);

  const result = await requestImageResponse(
    settings.baseUrl,
    settings.apiKey,
    params.model,
    messages,
    imageConfig,
    signal
  );

  // 避免在控制台打印超大的 base64（会卡死 DevTools）
  const responseContent = result.choices?.[0]?.message?.content;
  const contentLen = typeof responseContent === 'string' ? responseContent.length : undefined;
  const imageLen = result._imageData?.length;
  if ((contentLen && contentLen > 20000) || (imageLen && imageLen > 20000)) {
    debugLog('API Response:', {
      finish_reason: result.choices?.[0]?.finish_reason,
      has_image: !!result._imageData,
      image_len: imageLen,
      content_type: typeof responseContent,
      content_len: contentLen,
      content_prefix:
        typeof responseContent === 'string' ? responseContent.slice(0, 60) : undefined,
    });
  } else {
    debugLog('API Response:', JSON.stringify(result, null, 2));
  }

  const image = extractImageFromResponse(result, params);
  if (image) {
    return finalizeImage(image, signal);
  }

  throw new Error('No image found in response. Check browser console for response structure.');
};

/** 批量生成图像 */
export const generateImages = async (
  params: GenerationParams,
  settings: OpenAISettings,
  options?: { signal?: AbortSignal; imageConfig?: ImageConfig }
): Promise<ImageGenerationOutcome[]> =>
  runBatchImageGeneration(params.count, (signal) =>
    generateSingle(params, settings, signal, options?.imageConfig)
  , { signal: options?.signal });

/** 编辑图像 */
export const editImage = async (
  sourceImage: string,
  instruction: string,
  model: string,
  settings: OpenAISettings,
  prevParams?: GenerationParams,
  options?: { signal?: AbortSignal; imageConfig?: ImageConfig }
): Promise<GeneratedImage> => {
  const signal = options?.signal;
  const aspectRatio = prevParams?.aspectRatio || '1:1';
  const imageSize = prevParams?.imageSize || '1K';

  // 压缩过大的图像
  let imageToSend = sourceImage;
  if (sourceImage.length > 1000000) {
    debugLog('Image too large, compressing...');
    imageToSend = await compressImage(sourceImage, 600);
  }

  const imageConfig: ImageConfig = filterImageConfigByModel(
    options?.imageConfig ?? buildImageConfig(aspectRatio, imageSize, model, prevParams?.personGeneration),
    model
  );

  const editParams: GenerationParams = {
    prompt: instruction,
    aspectRatio,
    imageSize,
    count: 1,
    model: model as ModelType,
  };

  debugLog('Edit request - Model:', model, 'Instruction:', instruction);

  // 优先尝试 /v1/images/edits（Antigravity 支持 multipart/form-data 图生图）
  try {
    const editsResult = await callImagesEditsAPI(
      settings.baseUrl,
      settings.apiKey,
      model,
      instruction,
      [imageToSend],
      imageConfig,
      signal,
    );
    const editsImage = extractImageFromResponse(editsResult, editParams);
    if (editsImage) {
      return finalizeImage(editsImage, signal);
    }
  } catch (error) {
    if (!isEndpointUnsupported(error)) throw error;
    debugLog('Images edits endpoint not supported, falling back to chat completions');
  }

  // 回退：通过 chat/completions 发送图生图请求
  const content: OpenAIContentPart[] = [
    {
      type: 'image_url',
      image_url: { url: imageToSend },
    },
    {
      type: 'text',
      text: `Based on this image, ${instruction}`,
    },
  ];

  const messages = [{ role: 'user', content }];

  const result = await requestImageResponse(
    settings.baseUrl,
    settings.apiKey,
    model,
    messages,
    imageConfig,
    signal
  );

  const image = extractImageFromResponse(result, editParams);
  if (image) {
    return finalizeImage(image, signal);
  }

  // 检查响应内容
  const responseContent = result.choices?.[0]?.message?.content;
  if (responseContent && typeof responseContent === 'string' && responseContent.length > 0) {
    throw new Error(`Edit failed: ${responseContent.substring(0, 100)}`);
  }

  throw new Error('Image editing returned empty response. The provider may not support image input.');
};

/** 优化 Prompt（OpenAI 兼容） */
export const optimizePrompt = async (
  prompt: string,
  settings: { apiKey: string; baseUrl: string },
  model: string
): Promise<string> => {
  try {
    return await optimizePromptOpenAICompat(prompt, settings, model);
  } catch (error) {
    console.error('Prompt optimization failed:', error);
    throw error;
  }
};
