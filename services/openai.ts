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

/** 流式请求 OpenAI 兼容 API */
const callStreamingAPI = async (
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: OpenAIContentPart[] }>,
  imageConfig?: ImageConfig,
  signal?: AbortSignal
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
    body.response_format = { type: 'image' };
    if (imageConfig.aspectRatio) body.aspect_ratio = imageConfig.aspectRatio;
    if (imageConfig.imageSize) body.size = imageConfig.imageSize;
  }

  console.log('Request URL:', url);
  console.log('Request body:', JSON.stringify(body, null, 2));

  throwIfAborted(signal);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

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
  const content = buildMessageContent(params);
  const messages = [{ role: 'user', content }];

  const imageConfig: ImageConfig = imageConfigOverride ?? (() => {
    const cfg: ImageConfig = { aspectRatio: params.aspectRatio };
    if (params.model !== ModelType.NANO_BANANA && params.imageSize) {
      cfg.imageSize = params.imageSize;
    }
    return cfg;
  })();

  const result = await callStreamingAPI(
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
      if (outcomes[i].ok === false && outcomes[i].error === 'Unknown error') {
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

  const result = await callStreamingAPI(settings.baseUrl, settings.apiKey, model, messages, imageConfig, signal);

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

/** 优化 Prompt（OpenAI 兼容模式不保证有可用的文本模型） */
export const optimizePrompt = async (prompt: string): Promise<string> => {
  console.log('Prompt optimization skipped for OpenAI compatible mode (no guaranteed text model)');
  return prompt;
};
