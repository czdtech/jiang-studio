/**
 * Kie 官方 Base64 上传 API
 *
 * Kie 的 image_input / image_urls 仅接受 URL，因此需要先把本地图片上传。
 * 使用 Kie 官方的 Base64 上传 API：https://docs.kie.ai/file-upload-api/upload-file-base-64
 *
 * ⚠️ 大文件（>10MB）使用 Kie 官方 Stream Upload 以降低 base64 膨胀带来的网络开销。
 */

import { cleanBase64 } from './shared';

const KIE_UPLOAD_BASE_URL = 'https://kieai.redpandaai.co';
const KIE_UPLOAD_ENDPOINT = '/api/file-base64-upload';
const KIE_STREAM_ENDPOINT = '/api/file-stream-upload';
const SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB

type KieUploadResponse = {
  success?: boolean;
  code?: number;
  msg?: string;
  data?: {
    fileName?: string;
    filePath?: string;
    downloadUrl?: string;
    fileSize?: number;
    mimeType?: string;
    uploadedAt?: string;
  };
  error?: string;
  message?: string;
};

// 存储当前 Kie API Key（由调用方设置）
let currentApiKey: string | null = null;

/**
 * 估算 base64 解码后的字节大小（不包含 dataURL 前缀）
 *
 * 规则：bytes = len * 3/4 - padding
 */
export const estimateBase64Size = (base64Data: string): number => {
  if (!base64Data) return 0;

  let b64 = base64Data;

  // 优先复用 shared.ts 的清理逻辑（标准 data:image/*;base64, 前缀）
  if (b64.startsWith('data:image')) {
    b64 = cleanBase64(b64);
  }

  // 兜底：若仍为 dataURL，直接裁掉逗号前缀
  if (b64.startsWith('data:')) {
    const commaIndex = b64.indexOf(',');
    if (commaIndex >= 0) b64 = b64.slice(commaIndex + 1);
  }

  // 极少数情况下可能包含换行/空白
  if (/\s/.test(b64)) b64 = b64.replace(/\s/g, '');
  if (!b64) return 0;

  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  return Math.max(0, bytes);
};

/**
 * 将 data URL 转为 Blob（仅支持 PNG/JPEG/WebP 的 base64 dataURL）
 */
export const dataUrlToBlob = (dataUrl: string): Blob => {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('不支持的图片格式（仅支持 dataURL）');
  }

  const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/i);
  if (!mimeMatch) {
    throw new Error('不支持的图片格式（仅支持 base64 编码的 dataURL）');
  }

  const rawMime = mimeMatch[1].toLowerCase();
  const mimeType =
    rawMime === 'image/jpg' ? 'image/jpeg' :
    rawMime;

  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/webp') {
    throw new Error('不支持的图片格式（仅支持 PNG/JPEG/WebP 的 dataURL）');
  }

  // 复用 cleanBase64：适配 data:image/{png|jpeg|webp};base64,xxx
  const base64 = cleanBase64(dataUrl);

  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }

  // Node 环境兜底（例如测试环境）
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64, 'base64');
    return new Blob([buf], { type: mimeType });
  }

  throw new Error('当前环境不支持 base64 解码，无法转换为 Blob');
};

/**
 * 设置用于上传的 Kie API Key
 * 在调用 ensureImageUrl 之前必须先调用此函数
 */
export const setKieUploadApiKey = (apiKey: string) => {
  currentApiKey = apiKey;
};

/**
 * 使用 Kie 官方 Base64 上传 API 上传图片
 * 文档：https://docs.kie.ai/file-upload-api/upload-file-base-64
 */
export const uploadBase64ToKie = async (
  base64Data: string,
  options?: {
    apiKey?: string;
    fileName?: string;
    uploadPath?: string;
    signal?: AbortSignal;
  }
): Promise<string> => {
  const apiKey = options?.apiKey || currentApiKey;
  if (!apiKey) {
    throw new Error('Kie API Key 未设置，无法上传图片。请先配置 API Key。');
  }

  // 生成文件名
  const ext = base64Data.startsWith('data:image/png') ? 'png' : 
              base64Data.startsWith('data:image/jpeg') ? 'jpg' : 
              base64Data.startsWith('data:image/webp') ? 'webp' : 'png';
  const fileName = options?.fileName || `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uploadPath = options?.uploadPath || 'nano-banana-studio';

  const resp = await fetch(`${KIE_UPLOAD_BASE_URL}${KIE_UPLOAD_ENDPOINT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      base64Data,
      uploadPath,
      fileName,
    }),
    signal: options?.signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Kie 图片上传失败 ${resp.status}: ${text || resp.statusText}`);
  }

  const json = (await resp.json()) as KieUploadResponse;
  
  // 检查错误
  if (json.success === false || json.error || (json.msg && json.code !== 200)) {
    throw new Error(json.error || json.msg || json.message || 'Kie 图片上传失败');
  }
  
  const url = json.data?.downloadUrl;
  if (!url) {
    throw new Error('Kie 图片上传成功但未返回 downloadUrl');
  }
  
  return url;
};

/**
 * 使用 Kie 官方 Stream Upload 上传图片（multipart/form-data）
 * 文档：https://docs.kie.ai/file-upload-api/upload-file-stream
 */
export const uploadStreamToKie = async (
  blob: Blob,
  options?: {
    apiKey?: string;
    fileName?: string;
    uploadPath?: string;
    signal?: AbortSignal;
  }
): Promise<string> => {
  const apiKey = options?.apiKey || currentApiKey;
  if (!apiKey) {
    throw new Error('Kie API Key 未设置，无法上传图片。请先配置 API Key。');
  }

  const mime = (blob.type || '').toLowerCase();
  const ext =
    mime === 'image/png' ? 'png' :
    mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' :
    mime === 'image/webp' ? 'webp' :
    'png';

  const fileName =
    options?.fileName ||
    `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uploadPath = options?.uploadPath || 'nano-banana-studio';

  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('uploadPath', uploadPath);
  formData.append('fileName', fileName);

  const resp = await fetch(`${KIE_UPLOAD_BASE_URL}${KIE_STREAM_ENDPOINT}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
    signal: options?.signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Kie 图片上传失败 ${resp.status}: ${text || resp.statusText}`);
  }

  const json = (await resp.json()) as KieUploadResponse;

  if (json.success === false || json.error || (json.msg && json.code !== 200)) {
    throw new Error(json.error || json.msg || json.message || 'Kie 图片上传失败');
  }

  const url = json.data?.downloadUrl;
  if (!url) {
    throw new Error('Kie 图片上传成功但未返回 downloadUrl');
  }

  return url;
};

/**
 * 确保图片是 URL 格式（如果是 data URL 则上传到 Kie）
 */
export const ensureImageUrl = async (
  urlOrDataUrl: string,
  options?: { signal?: AbortSignal; apiKey?: string }
): Promise<string> => {
  // 已经是 HTTP URL，直接返回
  if (/^https?:\/\//.test(urlOrDataUrl)) {
    return urlOrDataUrl;
  }
  
  // 必须是 data URL 格式
  if (!urlOrDataUrl.startsWith('data:image')) {
    throw new Error('不支持的图片格式（仅支持 http(s) URL 或 data:image/* 的 dataURL）');
  }

  // 智能路由：大文件改用文件流上传（阈值：10MB）
  const estimatedSize = estimateBase64Size(urlOrDataUrl);
  if (estimatedSize > SIZE_THRESHOLD) {
    const blob = dataUrlToBlob(urlOrDataUrl);
    return uploadStreamToKie(blob, {
      apiKey: options?.apiKey,
      signal: options?.signal,
    });
  }

  // 小文件保持现有 base64 上传逻辑
  return uploadBase64ToKie(urlOrDataUrl, {
    apiKey: options?.apiKey,
    signal: options?.signal,
  });
};
