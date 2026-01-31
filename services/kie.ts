/**
 * Kie AI Jobs API（nano-banana-pro 等）
 */
import { GenerationParams, GeneratedImage, ModelType } from '../types';
import {
  createAbortError,
  createGeneratedImage,
  runWithConcurrency,
  throwIfAborted,
  urlToBase64,
  InternalGeneratedImage,
} from './shared';
import { ensureImageUrl } from './kieUpload';

const MAX_CONCURRENCY = 2;
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

const buildKieInput = (
  params: GenerationParams,
  imageInputUrls: string[]
): Record<string, unknown> => {
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio,
    resolution: params.imageSize,
    output_format: params.outputFormat || 'png',
  };
  if (imageInputUrls.length > 0) input.image_input = imageInputUrls;
  return input;
};

const resolveImageInputUrls = async (
  images: string[],
  signal?: AbortSignal
): Promise<string[]> => {
  const list: string[] = [];
  for (const img of images) {
    if (signal?.aborted) throw createAbortError();
    if (!img || typeof img !== 'string') continue;
    const url = await ensureImageUrl(img, { signal });
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
  const signal = options?.signal;
  const model = String(params.model || '').trim();
  if (!model) throw new Error('模型名为空');

  const imageInputUrls = options?.imageInputUrls
    ? await resolveImageInputUrls(options.imageInputUrls, signal)
    : await resolveImageInputUrls(params.referenceImages || [], signal);

  const taskId = await createTask(settings, model, buildKieInput(params, imageInputUrls), signal);
  const urls = await waitForResultUrls(settings, taskId, { signal });

  const img = createGeneratedImage(urls[0]!, params, true);
  return finalizeImage(img, signal);
};

export const generateImages = async (
  params: GenerationParams,
  settings: KieSettings,
  options?: { signal?: AbortSignal; imageInputUrls?: string[] }
): Promise<ImageGenerationOutcome[]> => {
  const signal = options?.signal;
  const formatError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  // refImages 上传一次，复用给并发任务，避免每张图重复上传
  const raw = options?.imageInputUrls ?? params.referenceImages ?? [];
  const sharedImageInputUrls = raw.length > 0 ? await resolveImageInputUrls(raw, signal) : [];

  const perTaskOptions = { ...options, imageInputUrls: sharedImageInputUrls };

  const tasks = Array.from({ length: params.count }, (_, index) => async () => {
    if (signal?.aborted) {
      return { index, outcome: { ok: false, error: '已停止' } as const };
    }

    try {
      const image = await generateSingle(params, settings, perTaskOptions);
      return { index, outcome: { ok: true, image } as const };
    } catch (e) {
      if ((e as any)?.name === 'AbortError' || signal?.aborted) {
        return { index, outcome: { ok: false, error: '已停止' } as const };
      }
      return { index, outcome: { ok: false, error: formatError(e) } as const };
    }
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
  const signal = options?.signal;

  const aspectRatio = prevParams?.aspectRatio || '1:1';
  const imageSize = prevParams?.imageSize || '1K';

  const sourceUrl = await ensureImageUrl(sourceImageUrlOrDataUrl, { signal });
  const extra = await resolveImageInputUrls(options?.imageInputUrls || [], signal);
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
    buildKieInput(editParams, imageInputUrls),
    signal
  );

  const urls = await waitForResultUrls(settings, taskId, { signal });
  const img = createGeneratedImage(urls[0]!, editParams, true);
  return finalizeImage(img, signal);
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
