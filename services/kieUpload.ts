/**
 * Kie / aiquickdraw 上传：dataURL -> http(s) URL
 *
 * Kie 的 image_input 仅接受 URL，因此需要先把本地图片上传到 aiquickdraw 的对象存储。
 */

const DEFAULT_UPLOAD_BASE_URL = 'https://upload.aiquickdraw.com';
const UPLOAD_PATH_DEFAULT = 'static';
const UPLOAD_ENDPOINT = '/upload';

// 来自 Kie 前端（NEXT_PUBLIC_R2_PUBLIC_KEY）
const R2_PUBLIC_KEY_BASE64 =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq+574K/dJuvv1IvTegESQ2gwIDNqb3zTrPMh0xCxanDXU19edTIuIytc2ab2OfDee+GqL6i1vYrhhczrCi5balF5O+XF/jKSKEDSZkSB5QI/2hLXP1mfIMWTWvU3OkTJ4arZwUEzqIQWY2uO3OZb7AK3OYZf6xUQZqdG3Yy7zxHLXSdnwFWFMWVG3WvboAlmggoqxp/w6IfDKwciYwV82lwUMo9y0DBuRYuYY4quLFv4HrURul0YX4jmCBhPx0mlQKoCq4I/jXqCBqodI65hwwoQ/V2VbQ5mWBUxuEuwLlROIBLJkEhD2NL08xxvUbf9W7UQFPX19qmw82FJTai5dwIDAQAB';

type UploadResponse = {
  success?: boolean;
  data?: { url?: string };
  error?: string;
};

const base64ToArrayBuffer = (b64: string): ArrayBuffer => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

const encryptUploadAuth = async (payload: string, publicKeyBase64: string): Promise<string> => {
  const spki = base64ToArrayBuffer(publicKeyBase64);
  const key = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );

  const data = new TextEncoder().encode(payload);
  const cipher = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, data);
  return arrayBufferToBase64(cipher);
};

export const dataUrlToFile = (dataUrl: string, fileName: string): File => {
  const parts = dataUrl.split(',');
  const meta = parts[0] || '';
  const b64 = parts[1] || '';

  const match = meta.match(/:(.*?);/);
  if (!match?.[1]) throw new Error('无效的 dataURL（缺少 mimeType）');
  const mime = match[1];

  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const blob = new Blob([bytes], { type: mime });
  return new File([blob], fileName, { type: mime });
};

export const uploadFileToAiquickdraw = async (
  file: File,
  options?: {
    baseUrl?: string;
    path?: string;
    bucket?: string;
    signal?: AbortSignal;
  }
): Promise<string> => {
  if (!file) throw new Error('File is required');
  const baseUrl = (options?.baseUrl || DEFAULT_UPLOAD_BASE_URL).replace(/\/$/, '');
  const path = options?.path || UPLOAD_PATH_DEFAULT;
  if (!path) throw new Error('File path is required');

  const normalizedPath = path.replace(/^\/+|\/+$/g, '');
  const payload = JSON.stringify({
    timestamp: Date.now(),
    path: normalizedPath,
    fileName: file.name,
  });

  const encrypted = await encryptUploadAuth(payload, R2_PUBLIC_KEY_BASE64);

  const form = new FormData();
  form.append('file', file);
  form.append('path', path);
  if (options?.bucket) form.append('bucket', options.bucket);

  const resp = await fetch(`${baseUrl}${UPLOAD_ENDPOINT}`, {
    method: 'POST',
    headers: {
      Authorization: `Encrypted ${encrypted}`,
    },
    body: form,
    signal: options?.signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Upload failed ${resp.status}: ${text || resp.statusText}`);
  }

  const json = (await resp.json()) as UploadResponse;
  if (!json.success) throw new Error(json.error || 'Upload failed');
  const url = json.data?.url;
  if (!url) throw new Error('Upload succeeded but missing url');
  return url;
};

export const ensureImageUrl = async (
  urlOrDataUrl: string,
  options?: { signal?: AbortSignal }
): Promise<string> => {
  if (/^https?:\/\//.test(urlOrDataUrl)) return urlOrDataUrl;
  if (!urlOrDataUrl.startsWith('data:image')) {
    throw new Error('不支持的图片格式（仅支持 http(s) URL 或 data:image/* 的 dataURL）');
  }
  const ext = urlOrDataUrl.startsWith('data:image/png') ? 'png' : urlOrDataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png';
  const file = dataUrlToFile(urlOrDataUrl, `upload_${Date.now()}.${ext}`);
  return uploadFileToAiquickdraw(file, { signal: options?.signal });
};

