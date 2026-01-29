import { GeneratedImage, ProviderDraft, ProviderProfile, ProviderScope } from '../types';

const DB_NAME = 'NanoBananaDB';
const IMAGE_STORE = 'images';
const PROVIDER_STORE = 'providers';
const DRAFT_STORE = 'drafts';
const SETTINGS_STORE = 'settings';
const VERSION = 2;

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PROVIDER_STORE)) {
        db.createObjectStore(PROVIDER_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// ============ Settings ============

type SettingRecord = { key: string; value: unknown };

export const setSetting = async (key: string, value: unknown): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    const request = store.put({ key, value } satisfies SettingRecord);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getSetting = async <T>(key: string): Promise<T | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const store = tx.objectStore(SETTINGS_STORE);
    const request = store.get(key);
    request.onsuccess = () => {
      const record = request.result as SettingRecord | undefined;
      resolve((record?.value as T) ?? null);
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteSetting = async (key: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const GALLERY_DIR_KEY = 'galleryDirectoryHandle';

export const getGalleryDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  return getSetting<FileSystemDirectoryHandle>(GALLERY_DIR_KEY);
};

export const setGalleryDirectoryHandle = async (handle: FileSystemDirectoryHandle): Promise<void> => {
  await setSetting(GALLERY_DIR_KEY, handle);
};

export const clearGalleryDirectoryHandle = async (): Promise<void> => {
  await deleteSetting(GALLERY_DIR_KEY);
};

// ============ Providers ============

export const getProviders = async (scope: ProviderScope): Promise<ProviderProfile[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROVIDER_STORE, 'readonly');
    const store = tx.objectStore(PROVIDER_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const all = (request.result as ProviderProfile[]) || [];
      const filtered = all
        .filter((p) => p.scope === scope)
        .sort((a, b) => {
          const favA = a.favorite ? 1 : 0;
          const favB = b.favorite ? 1 : 0;
          if (favA !== favB) return favB - favA;
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
};

export const upsertProvider = async (provider: ProviderProfile): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROVIDER_STORE, 'readwrite');
    const store = tx.objectStore(PROVIDER_STORE);
    const request = store.put(provider);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const deleteProvider = async (providerId: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PROVIDER_STORE, DRAFT_STORE], 'readwrite');
    const providerStore = tx.objectStore(PROVIDER_STORE);
    const draftStore = tx.objectStore(DRAFT_STORE);
    providerStore.delete(providerId);

    // Best-effort: 清理所有 scope 的草稿
    const draftReq = draftStore.getAllKeys();
    draftReq.onsuccess = () => {
      const keys = draftReq.result as IDBValidKey[];
      for (const k of keys) {
        if (typeof k === 'string' && k.endsWith(`:${providerId}`)) {
          draftStore.delete(k);
        }
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const activeProviderKey = (scope: ProviderScope) => `activeProvider:${scope}`;

export const getActiveProviderId = async (scope: ProviderScope): Promise<string | null> => {
  return getSetting<string>(activeProviderKey(scope));
};

export const setActiveProviderId = async (scope: ProviderScope, providerId: string): Promise<void> => {
  await setSetting(activeProviderKey(scope), providerId);
};

// ============ Drafts ============

const draftKey = (scope: ProviderScope, providerId: string) => `${scope}:${providerId}`;

type DraftRecord = ProviderDraft & { key: string };

export const getDraft = async (scope: ProviderScope, providerId: string): Promise<ProviderDraft | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readonly');
    const store = tx.objectStore(DRAFT_STORE);
    const request = store.get(draftKey(scope, providerId));
    request.onsuccess = () => {
      const record = request.result as DraftRecord | undefined;
      if (!record) return resolve(null);
      const { key: _k, ...draft } = record;
      resolve(draft);
    };
    request.onerror = () => reject(request.error);
  });
};

export const upsertDraft = async (draft: ProviderDraft): Promise<void> => {
  const db = await openDB();
  const record: DraftRecord = { ...draft, key: draftKey(draft.scope, draft.providerId) };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite');
    const store = tx.objectStore(DRAFT_STORE);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// ============ Portfolio (Images) ============

const dataUrlToBlob = (dataUrl: string): { blob: Blob; mime: string; ext: string } => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) {
    // fallback: treat as png
    return { blob: new Blob([dataUrl], { type: 'image/png' }), mime: 'image/png', ext: 'png' };
  }
  const mime = match[1] || 'image/png';
  const base64 = match[2] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const ext =
    mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('jpeg') ? 'jpg' : 'png';

  return { blob: new Blob([bytes], { type: mime }), mime, ext };
};

const createThumbnail = async (dataUrl: string, maxDim = 512, quality = 0.82): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (!width || !height) return resolve(dataUrl);

      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

export const saveImageToPortfolio = async (image: GeneratedImage): Promise<void> => {
  // 如果用户已选择“图库目录”，优先落盘；否则回退到 IndexedDB（会占用配额）
  const galleryDir = await getGalleryDirectoryHandle();

  let recordToStore: GeneratedImage = image;
  if (
    galleryDir &&
    typeof (galleryDir as FileSystemDirectoryHandle).getFileHandle === 'function' &&
    image.base64.startsWith('data:image')
  ) {
    // 注意：持久化的目录句柄在新会话里通常是 "prompt" 状态。
    // 如果这里直接触发 getFileHandle 可能会尝试弹权限提示；但在非用户手势下会报
    // "User activation is required..."。因此先 queryPermission，未授权则直接回退到 IDB。
    const canWrite = await (async () => {
      try {
        const q = (galleryDir as any).queryPermission;
        if (typeof q !== 'function') return true;
        const state = await q.call(galleryDir, { mode: 'readwrite' });
        return state === 'granted';
      } catch {
        return false;
      }
    })();

    if (!canWrite) {
      recordToStore = { ...image, storage: 'idb' };
    } else {
      try {
        const { blob, ext } = dataUrlToBlob(image.base64);
        const safeTs = new Date(image.timestamp).toISOString().replace(/[:.]/g, '-');
        const fileName = `nano-banana-${safeTs}-${image.id}.${ext}`;

        const fileHandle = await galleryDir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();

        const thumbnail = await createThumbnail(image.base64, 512, 0.82);

        recordToStore = {
          ...image,
          base64: thumbnail,
          fileHandle,
          fileName,
          storage: 'fs',
        };
      } catch (err) {
        console.warn('Failed to save image to disk, falling back to IndexedDB:', err);
        recordToStore = { ...image, storage: 'idb' };
      }
    }
  } else {
    recordToStore = { ...image, storage: 'idb' };
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readwrite');
    const store = tx.objectStore(IMAGE_STORE);
    const request = store.put(recordToStore);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getPortfolio = async (): Promise<GeneratedImage[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readonly');
    const store = tx.objectStore(IMAGE_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      // Sort by timestamp desc
      const results = request.result as GeneratedImage[];
      resolve(results.sort((a, b) => b.timestamp - a.timestamp));
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteImageFromPortfolio = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readwrite');
    const store = tx.objectStore(IMAGE_STORE);

    // 尝试同时删除落盘文件（best-effort，删除记录后再异步删除文件，避免事务失效）
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as GeneratedImage | undefined;
      const fileNameToRemove = record?.storage === 'fs' ? record.fileName : undefined;

      const delReq = store.delete(id);
      delReq.onsuccess = () => {
        resolve();
        if (!fileNameToRemove) return;
        // fire-and-forget
        void (async () => {
          try {
            const dir = await getGalleryDirectoryHandle();
            if (dir && typeof dir.removeEntry === 'function') {
              // 避免在无用户手势下触发权限提示导致的 SecurityError
              const canWrite = await (async () => {
                try {
                  const q = (dir as any).queryPermission;
                  if (typeof q !== 'function') return true;
                  const state = await q.call(dir, { mode: 'readwrite' });
                  return state === 'granted';
                } catch {
                  return false;
                }
              })();
              if (!canWrite) return;
              await dir.removeEntry(fileNameToRemove);
            }
          } catch (e) {
            console.warn('Failed to remove file from gallery directory:', e);
          }
        })();
      };
      delReq.onerror = () => reject(delReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
};
