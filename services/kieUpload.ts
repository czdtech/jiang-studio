/**
 * Kie 官方 Base64 上传 API
 *
 * Kie 的 image_input / image_urls 仅接受 URL，因此需要先把本地图片上传。
 * 使用 Kie 官方的 Base64 上传 API：https://docs.kie.ai/file-upload-api/upload-file-base-64
 */

const KIE_UPLOAD_BASE_URL = 'https://kieai.redpandaai.co';
const KIE_UPLOAD_ENDPOINT = '/api/file-base64-upload';

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
  
  // 上传到 Kie 并返回 URL
  return uploadBase64ToKie(urlOrDataUrl, {
    apiKey: options?.apiKey,
    signal: options?.signal,
  });
};

