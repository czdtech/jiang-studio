/**
 * OpenAI 兼容 API 实现
 */
import { GenerationParams, GeneratedImage, ModelType } from '../types';
import {
  cleanBase64,
  createGeneratedImage,
  runWithConcurrency,
  aggregateErrors,
  urlToBase64,
  compressImage,
  createAbortError,
  throwIfAborted,
  OpenAIResponse,
  OpenAIChoice,
  OpenAIContentPart,
  OpenAIMessage,
  ImageConfig,
  InternalGeneratedImage,
} from './shared';

const MAX_CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 60000;

const createTimeoutSignal = (signal?: AbortSignal, timeoutMs?: number) => {
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

export type ImageGenerationOutcome =
  | { ok: true; image: GeneratedImage }
  | { ok: false; error: string };

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

const parseAspectRatioValue = (ratio?: string): number | null => {
  if (!ratio || ratio === 'auto') return null;
  const parts = ratio.split(':').map((p) => Number(p));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || parts[1] === 0) return null;
  return parts[0] / parts[1];
};

const mapOpenAIImageSize = (imageSize?: string, aspectRatio?: string): string | undefined => {
  if (!imageSize) return undefined;
  if (/^\d+x\d+$/i.test(imageSize)) return imageSize;

  const normalized = imageSize.toUpperCase();
  if (!['1K', '2K', '4K'].includes(normalized)) return imageSize;

  const ratio = parseAspectRatioValue(aspectRatio);
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

const buildGeminiImageConfig = (params: GenerationParams): ImageConfig => {
  const config: ImageConfig = { aspectRatio: params.aspectRatio };
  if (params.model !== ModelType.NANO_BANANA && params.imageSize) {
    config.imageSize = params.imageSize;
  }
  return config;
};

const extractGeminiImageFromResponse = (
  response: { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> },
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
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/v1/chat/completions`;

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
    if (imageConfig.imageSize) body.size = imageConfig.imageSize;
  }

  console.log('Request URL:', url);
  console.log('Request body:', JSON.stringify(body, null, 2));

  throwIfAborted(signal);
  const { signal: timedSignal, cleanup, didTimeout } = createTimeoutSignal(signal, REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timedSignal,
    });
  } catch (error) {
    if (didTimeout()) throw new Error('请求超时');
    throw error;
  } finally {
    cleanup();
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

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
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/v1/images/generations`;
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
  };

  if (imageConfig?.imageSize) {
    body.size = imageConfig.imageSize;
  }

  console.log('Images API URL:', url);
  console.log('Images API body:', JSON.stringify(body, null, 2));

  throwIfAborted(signal);
  const { signal: timedSignal, cleanup, didTimeout } = createTimeoutSignal(signal, REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timedSignal,
    });
  } catch (error) {
    if (didTimeout()) throw new Error('请求超时');
    throw error;
  } finally {
    cleanup();
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return (await response.json()) as OpenAIResponse;
};

const callGeminiRelayAPI = async (
  params: GenerationParams,
  settings: OpenAISettings,
  signal?: AbortSignal
): Promise<GeneratedImage> => {
  const cleanBaseUrl = settings.baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/v1beta/models/${params.model}:generateContent`;
  const contents = buildGeminiContents(params);
  const imageConfig = buildGeminiImageConfig(params);
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig,
    },
  };

  console.log('Gemini Relay URL:', url);
  console.log('Gemini Relay body:', JSON.stringify(body, null, 2));

  throwIfAborted(signal);
  const { signal: timedSignal, cleanup, didTimeout } = createTimeoutSignal(signal, REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timedSignal,
    });
  } catch (error) {
    if (didTimeout()) throw new Error('请求超时');
    throw error;
  } finally {
    cleanup();
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const result = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
  };
  const image = extractGeminiImageFromResponse(result, params);
  if (image) return image;

  console.log('Gemini Relay Response:', JSON.stringify(result, null, 2));
  throw new Error('No image in Gemini relay response. Check browser console.');
};

const callGeminiChatRelayAPI = async (
  params: GenerationParams,
  settings: OpenAISettings,
  signal?: AbortSignal
): Promise<OpenAIResponse> => {
  const cleanBaseUrl = settings.baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/v1/chat/completions`;
  const contents = buildGeminiContents(params);
  const imageConfig = buildGeminiImageConfig(params);
  const body: Record<string, unknown> = {
    model: params.model,
    stream: true,
    max_tokens: 8192,
    messages: [{ role: 'user', content: params.prompt }],
    contents,
    extra_body: {
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig,
      },
    },
  };

  console.log('Gemini Chat Relay URL:', url);
  console.log('Gemini Chat Relay body:', JSON.stringify(body, null, 2));

  throwIfAborted(signal);
  const { signal: timedSignal, cleanup, didTimeout } = createTimeoutSignal(signal, REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timedSignal,
    });
  } catch (error) {
    if (didTimeout()) throw new Error('请求超时');
    throw error;
  } finally {
    cleanup();
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

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

  console.log('Stream completed. Image found:', !!imageData);

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
  const requestOnce = (cfg?: ImageConfig, omitResponseFormat?: boolean) =>
    callStreamingAPI(baseUrl, apiKey, model, messages, cfg, signal, { omitResponseFormat });

  const requestWithSizeFallback = async (cfg?: ImageConfig, omitResponseFormat?: boolean) => {
    try {
      return await requestOnce(cfg, omitResponseFormat);
    } catch (error) {
      if (!cfg?.imageSize || !isInvalidSizeError(error)) {
        throw error;
      }

      const mappedSize = mapOpenAIImageSize(cfg.imageSize, cfg.aspectRatio);
      if (mappedSize && mappedSize !== cfg.imageSize) {
        try {
          return await requestOnce({ ...cfg, imageSize: mappedSize }, omitResponseFormat);
        } catch (retryError) {
          if (!isInvalidSizeError(retryError)) throw retryError;
          const { imageSize: _omit, ...rest } = cfg;
          const fallback = Object.keys(rest).length > 0 ? rest : undefined;
          return await requestOnce(fallback, omitResponseFormat);
        }
      }

      const { imageSize: _omit, ...rest } = cfg;
      const fallback = Object.keys(rest).length > 0 ? rest : undefined;
      return await requestOnce(fallback, omitResponseFormat);
    }
  };

  const extractPromptText = () => {
    const parts: string[] = [];
    for (const msg of messages) {
      const content = msg.content;
      if (typeof content === 'string') {
        if (content.trim()) parts.push(content.trim());
        continue;
      }
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
      return await callImagesAPI(baseUrl, apiKey, model, promptText, finalCfg, signal);
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

/** 处理可能是 URL 的图像 */
const finalizeImage = async (image: InternalGeneratedImage, signal?: AbortSignal): Promise<GeneratedImage> => {
  if (image._isUrl || (!image.base64.startsWith('data:') && image.base64.startsWith('http'))) {
    console.log('Converting image URL to base64:', image.base64);
    image.base64 = await urlToBase64(image.base64, signal);
    delete image._isUrl;
  }
  return image;
};

/** 单次生成 */
const generateSingle = async (
  params: GenerationParams,
  settings: OpenAISettings,
  signal?: AbortSignal,
  imageConfigOverride?: ImageConfig
): Promise<GeneratedImage> => {
  if (isGeminiModel(params.model)) {
    const shouldUseNativeRelay =
      settings.baseUrl.includes('generativelanguage.googleapis.com') || settings.baseUrl.includes('/v1beta');
    if (shouldUseNativeRelay) {
      return await callGeminiRelayAPI(params, settings, signal);
    }
    return await requestGeminiChatImage(params, settings, signal);
  }

  const content = buildMessageContent(params);
  const messages = [{ role: 'user', content }];

  const imageConfig: ImageConfig = imageConfigOverride ?? (() => {
    const cfg: ImageConfig = { aspectRatio: params.aspectRatio };
    if (params.model !== ModelType.NANO_BANANA && params.imageSize) {
      cfg.imageSize = params.imageSize;
    }
    return cfg;
  })();

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
    console.log('API Response:', {
      finish_reason: result.choices?.[0]?.finish_reason,
      has_image: !!result._imageData,
      image_len: imageLen,
      content_type: typeof responseContent,
      content_len: contentLen,
      content_prefix:
        typeof responseContent === 'string' ? responseContent.slice(0, 60) : undefined,
    });
  } else {
    console.log('API Response:', JSON.stringify(result, null, 2));
  }

  const image = extractImageFromResponse(result, params);
  if (image) {
    if (image._isUrl || (!image.base64.startsWith('data:') && image.base64.startsWith('http'))) {
      console.log('Converting image URL to base64:', image.base64);
      image.base64 = await urlToBase64(image.base64, signal);
      delete image._isUrl;
      return image;
    }

    return image;
  }

  throw new Error('No image found in response. Check browser console for response structure.');
};

/** 批量生成图像 */
export const generateImages = async (
  params: GenerationParams,
  settings: OpenAISettings,
  options?: { signal?: AbortSignal; imageConfig?: ImageConfig }
): Promise<ImageGenerationOutcome[]> => {
  const signal = options?.signal;
  const imageConfigOverride = options?.imageConfig;
  const formatError = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const maxAttemptsPerImage = 2; // 失败后再重试 1 次
  const isRetriableError = (message: string): boolean => {
    if (signal?.aborted) return false;
    const m = message.match(/API error (\d{3})/);
    if (!m) return true;
    const status = Number(m[1]);
    // 4xx 基本都是请求/鉴权问题（除了 429），重试意义不大，还会刷屏
    if (status >= 400 && status < 500 && status !== 429) return false;
    return true;
  };

  const tasks = Array.from({ length: params.count }, (_, index) => async () => {
    if (signal?.aborted) {
      return { index, outcome: { ok: false, error: '已停止' } as const };
    }

    let lastErr: string | null = null;
    for (let attempt = 0; attempt < maxAttemptsPerImage; attempt++) {
      try {
        if (signal?.aborted) throw createAbortError();
        const image = await generateSingle(params, settings, signal, imageConfigOverride);
        return { index, outcome: { ok: true, image } as const };
      } catch (e) {
        lastErr = formatError(e);
        if ((e as any)?.name === 'AbortError' || signal?.aborted) {
          return { index, outcome: { ok: false, error: '已停止' } as const };
        }
        if (attempt < maxAttemptsPerImage - 1 && lastErr && isRetriableError(lastErr)) {
          await new Promise((r) => setTimeout(r, 300));
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
    console.log('Image too large, compressing...');
    imageToSend = await compressImage(sourceImage, 600);
  }

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

  const imageConfig: ImageConfig = options?.imageConfig ?? (() => {
    const cfg: ImageConfig = { aspectRatio };
    if (model !== ModelType.NANO_BANANA && imageSize) {
      cfg.imageSize = imageSize;
    }
    return cfg;
  })();

  console.log('Edit request - Model:', model, 'Instruction:', instruction);

  const result = await requestImageResponse(
    settings.baseUrl,
    settings.apiKey,
    model,
    messages,
    imageConfig,
    signal
  );

  const editParams: GenerationParams = {
    prompt: instruction,
    aspectRatio,
    imageSize,
    count: 1,
    model: model as ModelType,
  };

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
  if (!model || !model.trim()) {
    throw new Error('请先设置提示词优化模型');
  }

  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert prompt engineer for AI image generation. Rewrite prompts to be more descriptive, detailed, and optimized for high-quality generation. Keep the core intent but enhance lighting, texture, and style details. Return ONLY the optimized prompt text.'
          },
          {
            role: 'user',
            content: `Original Prompt: ${prompt}`
          }
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const optimized = data.choices?.[0]?.message?.content?.trim();
    
    if (!optimized) {
      throw new Error('No response from optimization model');
    }

    return optimized;
  } catch (error) {
    console.error('Prompt optimization failed:', error);
    throw error;
  }
};
