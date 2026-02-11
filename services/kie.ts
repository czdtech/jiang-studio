/**
 * Kie AI Jobs API（nano-banana-pro 等）
 */
import { GenerationParams, GeneratedImage, ModelType } from '../types';
import {
  createAbortError,
  createGeneratedImage,
  runWithConcurrency,
  createTimeoutSignal,
  isRetriableError,
  MAX_CONCURRENCY,
  REQUEST_TIMEOUT_MS,
  throwIfAborted,
  urlToBase64,
  InternalGeneratedImage,
} from './shared';
import { ensureImageUrl } from './kieUpload';

const DEFAULT_POLL_INTERVAL_MS = 1500;

export type ImageGenerationOutcome =
  | { ok: true; image: GeneratedImage }
  | { ok: false; error: string };

export interface KieSettings {
  apiKey: string;
  baseUrl: string; // e.g. https://api.kie.ai
}

type KieApiResponse<T> = {
  code?: number;
  msg?: string;
  data?: T;
};

type KieCreateTaskData = {
  recordId?: string;
  taskId?: string;
  id?: string;
};

type KieRecordInfoData = {
  state?: string; // waiting | success | fail
  resultJson?: string;
  error?: string;
  msg?: string;
};

const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) throw createAbortError();
  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => resolve(), ms);
    if (!signal) return;
    const onAbort = () => {
      window.clearTimeout(t);
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const finalizeImage = async (image: InternalGeneratedImage, signal?: AbortSignal): Promise<GeneratedImage> => {
  if (image._isUrl || (!image.base64.startsWith('data:') && image.base64.startsWith('http'))) {
    image.base64 = await urlToBase64(image.base64, signal);
    delete image._isUrl;
  }
  return image;
};

const joinUrl = (baseUrl: string, path: string): string => {
  const clean = baseUrl.replace(/\/$/, '');
  return `${clean}${path}`;
};

export const createTask = async (
  settings: KieSettings,
  model: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> => {
  const url = joinUrl(settings.baseUrl, '/api/v1/jobs/createTask');

  throwIfAborted(signal);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Kie API error ${resp.status}: ${text || resp.statusText}`);
  }

  const json = (await resp.json()) as KieApiResponse<KieCreateTaskData>;
  if (json.code !== 200) throw new Error(json.msg || 'Kie createTask failed');

  const id = json.data?.recordId || json.data?.taskId || json.data?.id;
  if (!id) throw new Error('Kie createTask 返回缺少 taskId/recordId');
  return id;
};

export const getRecordInfo = async (
  settings: KieSettings,
  taskId: string,
  signal?: AbortSignal
): Promise<KieRecordInfoData> => {
  const url = joinUrl(settings.baseUrl, `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);

  throwIfAborted(signal);
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Kie API error ${resp.status}: ${text || resp.statusText}`);
  }

  const json = (await resp.json()) as KieApiResponse<KieRecordInfoData>;
  if (json.code !== 200) throw new Error(json.msg || 'Kie recordInfo failed');
  return json.data || {};
};

const extractResultUrls = (record: KieRecordInfoData): string[] => {
  if (!record) return [];
  const raw = record.resultJson;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as { resultUrls?: unknown };
    if (Array.isArray(parsed?.resultUrls)) {
      return parsed.resultUrls.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    }
  } catch {
    // ignore
  }

  return [];
};

export const waitForResultUrls = async (
  settings: KieSettings,
  taskId: string,
  options?: { signal?: AbortSignal; intervalMs?: number }
): Promise<string[]> => {
  const signal = options?.signal;
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  while (true) {
    const record = await getRecordInfo(settings, taskId, signal);
    const state = String(record?.state || '').toLowerCase();

    if (state === 'success') {
      const urls = extractResultUrls(record);
      if (urls.length === 0) throw new Error('Kie 任务成功但未返回 resultUrls');
      return urls;
    }

    if (state === 'fail') {
      throw new Error(record?.error || record?.msg || 'Kie 任务失败');
    }

    await sleep(intervalMs, signal);
  }
};

/**
 * 根据模型类型构建 Kie API 输入参数
 * 
 * 不同模型的参数格式：
 * - Nano Banana (google/nano-banana): prompt, image_size (比例), output_format
 * - Nano Banana Edit (google/nano-banana-edit): prompt, image_urls (必需), image_size, output_format
 * - Nano Banana Pro (nano-banana-pro): prompt, aspect_ratio, resolution, image_input, output_format
 * - Imagen 4 系列 (google/imagen4, google/imagen4-ultra, google/imagen4-fast): prompt, aspect_ratio, num_images, negative_prompt, seed
 */
const buildKieInput = (
  params: GenerationParams,
  imageInputUrls: string[],
  model: string
): Record<string, unknown> => {
  const modelLower = model.toLowerCase();
  
  // Nano Banana (标准) 和 Edit 使用 'jpeg'，Pro 使用 'jpg'
  // 统一将前端的 'jpg' 根据模型映射为正确的 API 值
  const isProModel = modelLower.includes('nano-banana-pro') || modelLower.includes('nanobananapro');
  const formatForApi = (fmt: string | undefined): string => {
    const f = fmt || 'png';
    if (f === 'jpg' && !isProModel) return 'jpeg'; // 标准/Edit 模型 API 要求 'jpeg'
    return f; // Pro 模型直接用 'jpg'，png 所有模型通用
  };
  
  // Imagen 4 系列
  if (modelLower.includes('imagen-4') || modelLower.includes('imagen4')) {
    const input: Record<string, unknown> = {
      prompt: params.prompt,
      aspect_ratio: params.aspectRatio,
    };
    // Imagen 4 不支持 image_input，只支持 negative_prompt、num_images、seed
    return input;
  }
  
  // Nano Banana Edit - 图片编辑模型
  if (modelLower.includes('nano-banana-edit') || modelLower.includes('nanobananaedit')) {
    if (imageInputUrls.length === 0) {
      throw new Error('Nano Banana Edit 模型需要提供参考图片（image_urls）');
    }
    return {
      prompt: params.prompt,
      image_urls: imageInputUrls.slice(0, 10), // 最多 10 张
      image_size: params.aspectRatio, // Nano Banana Edit 使用 image_size 存比例
      output_format: formatForApi(params.outputFormat),
    };
  }
  
  // Nano Banana Pro - 高质量模型
  if (isProModel) {
    const input: Record<string, unknown> = {
      prompt: params.prompt,
      aspect_ratio: params.aspectRatio,
      resolution: params.imageSize, // 1K/2K/4K
      output_format: formatForApi(params.outputFormat),
    };
    if (imageInputUrls.length > 0) {
      input.image_input = imageInputUrls.slice(0, 8); // 最多 8 张
    }
    return input;
  }
  
  // Nano Banana (默认) - 文生图/图生图
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    image_size: params.aspectRatio, // Nano Banana 使用 image_size 存比例
    output_format: formatForApi(params.outputFormat),
  };
  // 注意：标准 Nano Banana 不支持 image_input 参数
  return input;
};

const resolveImageInputUrls = async (
  images: string[],
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> => {
  const list: string[] = [];
  for (const img of images) {
    if (signal?.aborted) throw createAbortError();
    if (!img || typeof img !== 'string') continue;
    const url = await ensureImageUrl(img, { signal, apiKey });
    list.push(url);
    if (list.length >= 8) break;
  }
  return list;
};

const generateSingle = async (
  params: GenerationParams,
  settings: KieSettings,
  options?: { signal?: AbortSignal; imageInputUrls?: string[] }
): Promise<GeneratedImage> => {
  const outerSignal = options?.signal;
  const model = String(params.model || '').trim();
  if (!model) throw new Error('模型名为空');

  // 超时覆盖整个 createTask + 轮询周期
  const { signal, cleanup, didTimeout } = createTimeoutSignal(outerSignal, REQUEST_TIMEOUT_MS);

  try {
    const imageInputUrls = options?.imageInputUrls
      ? await resolveImageInputUrls(options.imageInputUrls, settings.apiKey, signal)
      : await resolveImageInputUrls(params.referenceImages || [], settings.apiKey, signal);

    const taskId = await createTask(settings, model, buildKieInput(params, imageInputUrls, model), signal);
    const urls = await waitForResultUrls(settings, taskId, { signal });

    const img = createGeneratedImage(urls[0]!, params, true);
    return finalizeImage(img, signal);
  } catch (e) {
    if (didTimeout()) throw new Error('请求超时');
    throw e;
  } finally {
    cleanup();
  }
};

export const generateImages = async (
  params: GenerationParams,
  settings: KieSettings,
  options?: { signal?: AbortSignal; imageInputUrls?: string[] }
): Promise<ImageGenerationOutcome[]> => {
  const signal = options?.signal;
  const formatError = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const maxAttemptsPerImage = 2; // 失败后再重试 1 次

  // refImages 上传一次，复用给并发任务，避免每张图重复上传
  const raw = options?.imageInputUrls ?? params.referenceImages ?? [];
  const sharedImageInputUrls = raw.length > 0 ? await resolveImageInputUrls(raw, settings.apiKey, signal) : [];

  const perTaskOptions = { ...options, imageInputUrls: sharedImageInputUrls };

  const tasks = Array.from({ length: params.count }, (_, index) => async () => {
    if (signal?.aborted) {
      return { index, outcome: { ok: false, error: '已停止' } as const };
    }

    let lastErr: string | null = null;
    for (let attempt = 0; attempt < maxAttemptsPerImage; attempt++) {
      try {
        if (signal?.aborted) throw createAbortError();
        const image = await generateSingle(params, settings, perTaskOptions);
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

export const editImage = async (
  sourceImageUrlOrDataUrl: string,
  instruction: string,
  model: string,
  settings: KieSettings,
  prevParams?: GenerationParams,
  options?: { signal?: AbortSignal; imageInputUrls?: string[] }
): Promise<GeneratedImage> => {
  const outerSignal = options?.signal;
  const aspectRatio = prevParams?.aspectRatio || '1:1';
  const imageSize = prevParams?.imageSize || '1K';

  // 超时覆盖整个编辑流程（上传 + createTask + 轮询）
  const { signal, cleanup, didTimeout } = createTimeoutSignal(outerSignal, REQUEST_TIMEOUT_MS);

  try {
    const sourceUrl = await ensureImageUrl(sourceImageUrlOrDataUrl, { signal, apiKey: settings.apiKey });
    const extra = await resolveImageInputUrls(options?.imageInputUrls || [], settings.apiKey, signal);
    const imageInputUrls = [sourceUrl, ...extra].slice(0, 8);

    const editParams: GenerationParams = {
      prompt: instruction,
      aspectRatio,
      imageSize,
      outputFormat: prevParams?.outputFormat,
      count: 1,
      model: model as ModelType,
    };

    const taskId = await createTask(
      settings,
      model,
      buildKieInput(editParams, imageInputUrls, model),
      signal
    );

    const urls = await waitForResultUrls(settings, taskId, { signal });
    const img = createGeneratedImage(urls[0]!, editParams, true);
    return finalizeImage(img, signal);
  } catch (e) {
    if (didTimeout()) throw new Error('请求超时');
    throw e;
  } finally {
    cleanup();
  }
};

/** 优化 Prompt（Kie AI） */
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
