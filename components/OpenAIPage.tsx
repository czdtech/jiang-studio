import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Wand2, Plus, ChevronDown, X, Plug, Star, Trash2 } from 'lucide-react';
import { OpenAISettings, GeneratedImage, GenerationParams, ModelType, ProviderProfile, ProviderScope, ProviderDraft } from '../types';
import { generateImages } from '../services/openai';
import { useToast } from './Toast';
import { ImageGrid, ImageGridSlot } from './ImageGrid';
import {
  deleteProvider as deleteProviderFromDb,
  getActiveProviderId as getActiveProviderIdFromDb,
  getDraft as getDraftFromDb,
  getProviders as getProvidersFromDb,
  setActiveProviderId as setActiveProviderIdInDb,
  upsertDraft as upsertDraftInDb,
  upsertProvider as upsertProviderInDb,
} from '../services/db';

interface OpenAIPageProps {
  portfolio: GeneratedImage[];
  saveImage: (image: GeneratedImage) => Promise<void>;
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
  variant?: 'third_party' | 'antigravity_tools';
}

/** 仅基于 model id 的通用启发式：只筛 Gemini 生图模型（不做任何单家中转特判） */
const isGeminiImageModelId = (id: string): boolean => {
  const s = id.toLowerCase();
  // 常见格式：gemini-3-pro-image、gemini-2.5-flash-image、gemini-3-pro-image-2k-9x16 等
  return s.includes('gemini') && s.includes('image');
};

const inferAntigravityImageConfigFromModelId = (
  modelId: string
): { aspectRatio?: GenerationParams['aspectRatio']; imageSize?: GenerationParams['imageSize'] } => {
  const s = modelId.toLowerCase();

  // 分辨率：通过模型后缀 -2k / -4k
  let imageSize: GenerationParams['imageSize'] | undefined;
  const sizeMatch = s.match(/(?:^|[-_])(2k|4k)(?:$|[-_])/);
  if (sizeMatch?.[1] === '2k') imageSize = '2K';
  if (sizeMatch?.[1] === '4k') imageSize = '4K';

  // 比例：通过模型后缀 -16x9 / -16-9 等
  let aspectRatio: GenerationParams['aspectRatio'] | undefined;
  const ratioMatch = s.match(/(?:^|[-_])(1|3|4|9|16|21)[x-](1|3|4|9|16)(?:$|[-_])/);
  if (ratioMatch) {
    const key = `${ratioMatch[1]}:${ratioMatch[2]}`;
    const allowed: Set<string> = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']);
    if (allowed.has(key)) aspectRatio = key as GenerationParams['aspectRatio'];
  }

  return { aspectRatio, imageSize };
};

const createDefaultProvider = (scope: ProviderScope): ProviderProfile => {
  const now = Date.now();
  if (scope === 'antigravity_tools') {
    return {
      id: crypto.randomUUID(),
      scope,
      name: '本地反代',
      apiKey: 'sk-antigravity',
      baseUrl: 'http://127.0.0.1:8045',
      defaultModel: 'gemini-3-pro-image',
      favorite: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id: crypto.randomUUID(),
    scope,
    name: '默认供应商',
    apiKey: '',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gemini-3-pro-image',
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
};

export const OpenAIPage = ({ saveImage, onImageClick, onEdit, variant = 'third_party' }: OpenAIPageProps) => {
  const { showToast } = useToast();
  const scope: ProviderScope = variant === 'antigravity_tools' ? 'antigravity_tools' : 'openai_proxy';
  const isAntigravityTools = variant === 'antigravity_tools';

  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [activeProviderId, setActiveProviderIdState] = useState<string>('');

  const activeProvider = useMemo(() => (
    providers.find((p) => p.id === activeProviderId) || null
  ), [providers, activeProviderId]);

  const isHydratingRef = useRef(false);
  const hydratedProviderIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const generationRunIdRef = useRef(0);
  const isMountedRef = useRef(false);

  useEffect(() => {
    // React StrictMode(dev) 会执行一次“mount->unmount->mount”来检测副作用；这里必须在 effect 中显式置 true。
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      try {
        abortControllerRef.current?.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  // 初始化：加载供应商列表与当前选中项
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const list = await getProvidersFromDb(scope);
      let nextProviders = list;
      if (nextProviders.length === 0) {
        const def = createDefaultProvider(scope);
        await upsertProviderInDb(def);
        nextProviders = [def];
      }

      const savedActiveId = await getActiveProviderIdFromDb(scope);
      const fallbackId = nextProviders[0]?.id || '';
      const nextActiveId =
        savedActiveId && nextProviders.some((p) => p.id === savedActiveId) ? savedActiveId : fallbackId;

      if (!savedActiveId || savedActiveId !== nextActiveId) {
        if (nextActiveId) await setActiveProviderIdInDb(scope, nextActiveId);
      }

      if (cancelled) return;
      setProviders(nextProviders);
      setActiveProviderIdState(nextActiveId);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [scope]);

  // Settings (OpenAI Compatible)
  const [settings, setSettings] = useState<OpenAISettings>(() => {
    if (variant === 'antigravity_tools') {
      return {
        apiKey: 'sk-antigravity',
        baseUrl: 'http://127.0.0.1:8045',
      };
    }
    return { apiKey: '', baseUrl: 'https://api.openai.com' };
  });

  // Generator State
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);

  const [customModel, setCustomModel] = useState(() => (
    variant === 'antigravity_tools' ? 'gemini-3-pro-image' : 'gemini-3-pro-image'
  ));

  const [providerName, setProviderName] = useState<string>('');
  const [providerFavorite, setProviderFavorite] = useState<boolean>(false);

  // Antigravity Tools model list (optional UX)
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableImageModels, setAvailableImageModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsHint, setModelsHint] = useState<string>('');

  // Params
  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    count: 1,
    model: ModelType.CUSTOM, // OpenAI 模式使用自定义模型
  });

  // Results
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [generatedSlots, setGeneratedSlots] = useState<ImageGridSlot[]>([]);

  const inferredAntigravityConfig = useMemo(() => {
    if (!isAntigravityTools) return null;
    return inferAntigravityImageConfigFromModelId(customModel);
  }, [customModel, isAntigravityTools]);

  // 应用当前供应商配置 + 加载草稿（每个供应商一份）
  useEffect(() => {
    if (!activeProvider) return;
    // 避免 provider 记录被 debounce 保存时触发“二次水合”，导致用户刚选的 model/草稿被旧数据覆盖
    if (hydratedProviderIdRef.current === activeProvider.id) return;
    hydratedProviderIdRef.current = activeProvider.id;

    let cancelled = false;
    isHydratingRef.current = true;

    setSettings({ apiKey: activeProvider.apiKey, baseUrl: activeProvider.baseUrl });
    setProviderName(activeProvider.name);
    setProviderFavorite(!!activeProvider.favorite);

    const cache = activeProvider.modelsCache;
    if (cache?.all?.length) {
      setAvailableModels(cache.all);
      const imageList = (cache.image?.length ? cache.image : cache.all).filter(isGeminiImageModelId);
      setAvailableImageModels(imageList);
      const dt = new Date(cache.fetchedAt).toLocaleString();
      setModelsHint(`已缓存模型列表（${cache.all.length}） • ${dt}`);
    } else if (cache?.lastError) {
      setAvailableModels([]);
      setAvailableImageModels([]);
      setModelsHint(cache.lastError);
    } else {
      setAvailableModels([]);
      setAvailableImageModels([]);
      setModelsHint('');
    }

    const loadDraft = async () => {
      const draft = await getDraftFromDb(scope, activeProvider.id);
      if (cancelled) return;

      if (draft) {
        setPrompt(draft.prompt || '');
        setParams(draft.params);
        setRefImages(draft.refImages || []);
        setCustomModel(draft.model || activeProvider.defaultModel || 'gemini-3-pro-image');
      } else {
        setPrompt('');
        setRefImages([]);
        setParams({
          prompt: '',
          aspectRatio: '1:1',
          imageSize: '1K',
          count: 1,
          model: ModelType.CUSTOM,
        });
        setCustomModel(activeProvider.defaultModel || 'gemini-3-pro-image');
      }

      isHydratingRef.current = false;
    };

    void loadDraft().catch((e) => {
      console.warn('Failed to load draft:', e);
      isHydratingRef.current = false;
    });

    return () => {
      cancelled = true;
    };
  }, [activeProvider, scope]);

  // 供应商配置持久化（名称/收藏/baseUrl/apiKey/默认模型）
  useEffect(() => {
    if (!activeProvider) return;
    if (isHydratingRef.current) return;

    const next: ProviderProfile = {
      ...activeProvider,
      name: providerName || activeProvider.name,
      favorite: providerFavorite,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      defaultModel: customModel,
      // 如果 baseUrl 变了，清掉缓存模型，避免误用
      modelsCache: settings.baseUrl !== activeProvider.baseUrl ? undefined : activeProvider.modelsCache,
      updatedAt: Date.now(),
    };

    const t = window.setTimeout(() => {
      void upsertProviderInDb(next).catch((e) => console.warn('Failed to save provider:', e));
      setProviders((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    }, 300);

    return () => window.clearTimeout(t);
  }, [
    activeProvider,
    providerName,
    providerFavorite,
    settings.apiKey,
    settings.baseUrl,
    customModel,
  ]);

  // 草稿持久化（每个供应商一份，包含 refImages）
  useEffect(() => {
    if (!activeProvider) return;
    if (isHydratingRef.current) return;

    const draft: ProviderDraft = {
      scope,
      providerId: activeProvider.id,
      prompt,
      params,
      refImages,
      model: customModel,
      updatedAt: Date.now(),
    };

    const t = window.setTimeout(() => {
      void upsertDraftInDb(draft).catch((e) => console.warn('Failed to save draft:', e));
    }, 350);

    return () => window.clearTimeout(t);
  }, [activeProvider, scope, prompt, params, refImages, customModel]);

  const handleSelectProvider = async (nextId: string) => {
    setActiveProviderIdState(nextId);
    await setActiveProviderIdInDb(scope, nextId);
  };

  const handleCreateProvider = async () => {
    const base = activeProvider || createDefaultProvider(scope);
    const now = Date.now();
    const created: ProviderProfile = {
      ...base,
      id: crypto.randomUUID(),
      name: base ? `复制 - ${base.name}` : '新供应商',
      favorite: false,
      createdAt: now,
      updatedAt: now,
      modelsCache: undefined,
    };

    await upsertProviderInDb(created);
    const next = await getProvidersFromDb(scope);
    setProviders(next);
    await handleSelectProvider(created.id);
  };

  const handleDeleteProvider = async () => {
    if (!activeProvider) return;
    if (providers.length <= 1) {
      showToast('至少保留一个供应商', 'error');
      return;
    }
    if (!confirm(`删除供应商「${activeProvider.name}」？`)) return;

    await deleteProviderFromDb(activeProvider.id);
    const next = await getProvidersFromDb(scope);
    setProviders(next);
    const nextActive = next[0]?.id || '';
    if (nextActive) await handleSelectProvider(nextActive);
  };

  const handleToggleFavorite = () => {
    setProviderFavorite((v) => !v);
  };

  const handleRefreshModels = async () => {
    if (!activeProvider) return;
    if (!settings.baseUrl) {
      showToast('Please enter a Base URL', 'error');
      return;
    }

    setIsLoadingModels(true);
    setModelsHint('');
    try {
      const cleanBaseUrl = settings.baseUrl.replace(/\/$/, '');
      const url = `${cleanBaseUrl}/v1/models`;

      const fetchModels = async (withAuth: boolean): Promise<Response> => {
        const headers: Record<string, string> = {};
        if (withAuth) {
          const key = settings.apiKey || (variant === 'antigravity_tools' ? 'sk-antigravity' : '');
          if (key) headers.Authorization = `Bearer ${key}`;
        }
        return fetch(url, { method: 'GET', headers });
      };

      // 先不带 Authorization，尽量避免浏览器 CORS 预检；如果返回 401/403 再带上 Authorization 重试。
      let resp = await fetchModels(false);
      if ((resp.status === 401 || resp.status === 403) && (settings.apiKey || variant === 'antigravity_tools')) {
        resp = await fetchModels(true);
      }

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`API error ${resp.status}: ${errText}`);
      }

      const json = (await resp.json()) as { data?: unknown[] };
      const raw = Array.isArray(json.data) ? json.data : [];

      const ids = raw
        .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

      const uniqueIds = Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
      setAvailableModels(uniqueIds);

      const geminiImageIds = uniqueIds.filter(isGeminiImageModelId);
      setAvailableImageModels(geminiImageIds);

      const modelsCache = {
        all: uniqueIds,
        image: geminiImageIds,
        fetchedAt: Date.now(),
        lastError: undefined,
      };

      const updatedProvider: ProviderProfile = {
        ...activeProvider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        modelsCache,
        updatedAt: Date.now(),
      };

      await upsertProviderInDb(updatedProvider);
      setProviders((prev) => prev.map((p) => (p.id === updatedProvider.id ? updatedProvider : p)));

      if (geminiImageIds.length > 0) {
        setModelsHint(`已刷新模型列表（${uniqueIds.length}），筛选到 ${geminiImageIds.length} 个 Gemini 生图模型。`);
      } else {
        setModelsHint(`已刷新模型列表（${uniqueIds.length}），但未找到 Gemini 生图模型；请手动输入模型名。`);
      }

      showToast('Models refreshed', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown';
      const hint = `无法从 /v1/models 拉取模型列表（可能是不支持该接口、被 CORS 拦截或需要鉴权）：${msg}`;
      setModelsHint(hint);

      const updatedProvider: ProviderProfile = {
        ...activeProvider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        modelsCache: {
          all: activeProvider.modelsCache?.all || [],
          image: activeProvider.modelsCache?.image || [],
          fetchedAt: activeProvider.modelsCache?.fetchedAt || Date.now(),
          lastError: hint,
        },
        updatedAt: Date.now(),
      };
      await upsertProviderInDb(updatedProvider);
      setProviders((prev) => prev.map((p) => (p.id === updatedProvider.id ? updatedProvider : p)));

      showToast('Failed to refresh models: ' + msg, 'error');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (!prompt) return;
    const model = customModel;
    if (!model.trim()) {
      showToast('Please enter a model name', 'error');
      return;
    }
    if (!settings.apiKey) {
      showToast('Please enter an API key', 'error');
      return;
    }
    if (!settings.baseUrl) {
      showToast('Please enter a Base URL', 'error');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    stopRequestedRef.current = false;
    const runId = ++generationRunIdRef.current;

    setIsGenerating(true);
    try {
      const currentParams: GenerationParams = {
        ...params,
        prompt,
        referenceImages: refImages,
        model: model as ModelType,
      };

      const antigravityConfig = isAntigravityTools ? inferAntigravityImageConfigFromModelId(model) : null;
      if (antigravityConfig?.aspectRatio) currentParams.aspectRatio = antigravityConfig.aspectRatio;
      if (antigravityConfig?.imageSize) currentParams.imageSize = antigravityConfig.imageSize;

      const slotIds = Array.from({ length: currentParams.count }, () => crypto.randomUUID());
      setGeneratedImages([]);
      setGeneratedSlots(slotIds.map((id) => ({ id, status: 'pending' })));

      const outcomes = await generateImages(currentParams, settings, {
        signal: controller.signal,
        // Antigravity Tools 推荐通过“模型后缀 / size 参数”控制比例与分辨率；这里不再额外传 aspect_ratio/size，避免冲突。
        imageConfig: isAntigravityTools ? {} : undefined,
      });
      if (!isMountedRef.current) return;
      if (generationRunIdRef.current !== runId) return;
      const nextSlots: ImageGridSlot[] = outcomes.map((o, i) => {
        if (o.ok === true) {
          const withSource: GeneratedImage = {
            ...o.image,
            sourceScope: scope,
            sourceProviderId: activeProviderId,
          };
          return { id: slotIds[i], status: 'success', image: withSource };
        }
        return { id: slotIds[i], status: 'error', error: o.error };
      });

      const successImages = nextSlots
        .filter((s): s is Extract<ImageGridSlot, { status: 'success' }> => s.status === 'success')
        .map((s) => s.image);

      setGeneratedSlots(nextSlots);
      setGeneratedImages(successImages);

      // Auto save to portfolio
      for (const img of successImages) {
        await saveImage(img);
      }

      const successCount = successImages.length;
      const failCount = currentParams.count - successCount;
      if (controller.signal.aborted) {
        showToast(successCount > 0 ? `已停止生成（已生成 ${successCount} 张）` : '已停止生成', 'info');
      } else if (successCount === 0) {
        showToast('Generation failed (see failed cards)', 'error');
      } else if (failCount > 0) {
        showToast('Generation completed (some failed, see cards)', 'info');
      } else {
        showToast('Generation completed', 'success');
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      if (generationRunIdRef.current !== runId) return;

      const aborted = (error as any)?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        // 将仍处于 pending 的卡片标记为“已停止”
        setGeneratedSlots((prev) =>
          prev.map((s) => (s.status === 'pending' ? { id: s.id, status: 'error', error: '已停止' } : s))
        );
        showToast('已停止生成', 'info');
        return;
      }

      showToast('Generation Error: ' + (error instanceof Error ? error.message : 'Unknown'), 'error');
    } finally {
      if (!isMountedRef.current) return;
      if (generationRunIdRef.current !== runId) return;
      setIsGenerating(false);
      abortControllerRef.current = null;
      stopRequestedRef.current = false;
    }
  };

  const handleStop = () => {
    if (!isGenerating) return;
    stopRequestedRef.current = true;
    try {
      abortControllerRef.current?.abort();
    } catch {
      // ignore
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      files.push(fileList[i]);
    }

    const newImages: string[] = [];
    let processedCount = 0;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          newImages.push(reader.result);
        }
        processedCount++;
        if (processedCount === files.length) {
          setRefImages((prev) => [...prev, ...newImages].slice(0, 4));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeRefImage = (index: number) => {
    setRefImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Left Controls */}
      <div className="lg:col-span-4 space-y-6">
        {/* API Configuration */}
        <div className="bg-dark-surface p-5 rounded-xl border border-dark-border shadow-lg">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Plug className="w-4 h-4" />{' '}
            {variant === 'antigravity_tools'
              ? 'Antigravity Tools (Local Proxy)'
              : 'OpenAI Compatible Settings'}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">供应商</label>
              <div className="flex gap-2">
                <select
                  value={activeProviderId}
                  onChange={(e) => void handleSelectProvider(e.target.value)}
                  className="flex-1 appearance-none bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {(p.favorite ? '★ ' : '') + (p.name || p.id)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void handleCreateProvider()}
                  className="px-3 py-2 rounded-lg border border-dark-border bg-dark-bg text-gray-300 hover:border-banana-500/60 hover:text-white transition-colors"
                  title="新增/复制供应商"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={handleToggleFavorite}
                  className={`px-3 py-2 rounded-lg border transition-colors ${
                    providerFavorite
                      ? 'border-banana-500/70 bg-banana-500/10 text-banana-300'
                      : 'border-dark-border bg-dark-bg text-gray-300 hover:border-banana-500/60 hover:text-white'
                  }`}
                  title="收藏"
                >
                  <Star className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void handleDeleteProvider()}
                  className="px-3 py-2 rounded-lg border border-dark-border bg-dark-bg text-gray-300 hover:border-red-500/60 hover:text-white transition-colors"
                  title="删除供应商"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">名称</label>
              <input
                type="text"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="给这个供应商起个名字"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key</label>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
                placeholder="sk-xxxx"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Base URL</label>
              <input
                type="text"
                value={settings.baseUrl}
                onChange={(e) => {
                  const next = e.target.value;
                  setSettings((s) => ({ ...s, baseUrl: next }));
                  setAvailableModels([]);
                  setAvailableImageModels([]);
                  setModelsHint('');
                }}
                placeholder="https://api.openai.com"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
              />
              {variant === 'antigravity_tools' ? (
                <p className="text-xs text-gray-500 mt-1">
                  Examples: http://127.0.0.1:8045 or http://&lt;LAN-IP&gt;:8045 (use http, keep port)
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">Examples: api.openai.com, api.openrouter.ai, etc.</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs text-gray-500">模型列表</label>
                <button
                  onClick={() => void handleRefreshModels()}
                  disabled={isLoadingModels || !settings.baseUrl}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    isLoadingModels || !settings.baseUrl
                      ? 'bg-dark-bg border-dark-border text-gray-500 cursor-not-allowed'
                      : 'bg-dark-bg border-dark-border text-gray-300 hover:border-banana-500/60 hover:text-white'
                  }`}
                  title="从 /v1/models 刷新并缓存到本地（只在点击时刷新）"
                >
                  {isLoadingModels ? '刷新中...' : '刷新模型'}
                </button>
              </div>
              {modelsHint && (
                <p className={`text-xs mt-2 ${modelsHint.startsWith('无法') ? 'text-yellow-500/80' : 'text-gray-500'}`}>
                  {modelsHint}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Prompt Input */}
        <div className="bg-dark-surface p-5 rounded-xl border border-dark-border shadow-lg">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-bold text-gray-300">Prompt</label>
            <span className="text-xs text-gray-500">
              <Wand2 className="w-3 h-3 inline mr-1" />
              Prompt optimization not available
            </span>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your imagination..."
            className="w-full h-32 bg-dark-bg border border-dark-border rounded-lg p-3 text-sm text-white placeholder-gray-600 focus:ring-2 focus:ring-banana-500 outline-none resize-none"
          />
        </div>

        {/* Reference Images */}
        <div className="bg-dark-surface p-5 rounded-xl border border-dark-border shadow-lg">
          <label className="block text-sm font-bold text-gray-300 mb-3">Reference Images</label>

          {refImages.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {refImages.map((img, idx) => (
                <div
                  key={idx}
                  className="relative group aspect-square rounded-lg overflow-hidden border border-dark-border"
                >
                  <img src={img} alt={`Ref ${idx}`} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeRefImage(idx)}
                    className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-red-500 rounded-full text-white transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {refImages.length < 4 && (
                <label className="flex items-center justify-center aspect-square border-2 border-dashed border-dark-border hover:border-banana-500/50 rounded-lg cursor-pointer bg-dark-bg/50 transition-colors">
                  <Plus className="w-5 h-5 text-gray-500" />
                  <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                </label>
              )}
            </div>
          )}

          {refImages.length === 0 && (
            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-dark-border hover:border-banana-500/50 rounded-lg cursor-pointer bg-dark-bg transition-colors">
              <Plus className="w-6 h-6 text-gray-500 mb-1" />
              <span className="text-xs text-gray-400">Upload References (Max 4)</span>
              <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
            </label>
          )}
          <p className="text-xs text-yellow-500/80 mt-2">⚠️ Reference images may not be supported by all providers.</p>
        </div>

        {/* Parameters */}
        <div className="bg-dark-surface p-5 rounded-xl border border-dark-border shadow-lg space-y-5">
          {/* Model Selection */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Model</label>

            <div className="space-y-3">
              <div>
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder={
                    variant === 'antigravity_tools'
                      ? 'e.g. gemini-3-pro-image-2k-9x16'
                      : 'e.g. gemini-3-pro-image / gemini-2.5-flash-image'
                  }
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
                />
              </div>

              {availableModels.length > 0 && (
                <>
                  {availableImageModels.length > 0 ? (
                    <>
                      <div className="relative">
                        {(() => {
                          const source = availableImageModels;
                          const selectedValue = source.includes(customModel) ? customModel : '';

                          return (
                            <select
                              value={selectedValue}
                              onChange={(e) => setCustomModel(e.target.value)}
                              className="w-full appearance-none bg-dark-bg border border-dark-border rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer"
                            >
                              <option value="" disabled>
                                选择模型…
                              </option>
                              {source.map((id) => (
                                <option key={id} value={id}>
                                  {id}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                          <ChevronDown className="w-4 h-4" />
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-500">
                      已加载模型列表，但未找到 Gemini 生图模型（下拉仅展示 Gemini 生图模型）。请手动输入模型名。
                    </p>
                  )}
                </>
              )}

              <p className="text-xs text-gray-500">
                Tip: use ids from <code className="text-gray-300">/v1/models</code> (e.g.{' '}
                <code className="text-gray-300">gemini-3-pro-image-9x16</code>). Avoid typos like{' '}
                <code className="text-gray-300">gemini-3.0-...</code> which will 404.
              </p>

              {isAntigravityTools && (
                <p className="text-xs text-gray-500">
                  Antigravity Tools：比例/分辨率建议直接选对应模型后缀（例如 <code className="text-gray-300">gemini-3-pro-image-4k-21x9</code>）。
                  {inferredAntigravityConfig?.aspectRatio || inferredAntigravityConfig?.imageSize ? (
                    <>
                      {' '}
                      当前模型解析：
                      <span className="text-gray-300">
                        {inferredAntigravityConfig?.imageSize ? ` ${inferredAntigravityConfig.imageSize}` : ''}
                        {inferredAntigravityConfig?.aspectRatio ? ` • ${inferredAntigravityConfig.aspectRatio}` : ''}
                      </span>
                      。
                    </>
                  ) : null}
                </p>
              )}
            </div>
          </div>

          {/* Aspect Ratio */}
          {!isAntigravityTools && (
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Aspect Ratio</label>
              <div className="grid grid-cols-5 gap-2">
                {(['1:1', '16:9', '9:16', '4:3', '3:4'] as const).map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => setParams({ ...params, aspectRatio: ratio })}
                    className={`py-2 text-xs rounded border transition-all ${
                      params.aspectRatio === ratio
                        ? 'bg-banana-500 text-black border-banana-500 font-bold'
                        : 'bg-dark-bg border-dark-border text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Resolution */}
          {!isAntigravityTools && (
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Resolution</label>
              <div className="grid grid-cols-3 gap-2">
                {(['1K', '2K', '4K'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => setParams({ ...params, imageSize: size })}
                    className={`py-2 text-xs rounded border transition-all ${
                      params.imageSize === size
                        ? 'bg-banana-500 text-black border-banana-500 font-bold'
                        : 'bg-dark-bg border-dark-border text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">Resolution support depends on provider.</p>
            </div>
          )}

          {/* Count */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Quantity: {params.count}
            </label>
            <input
              type="range"
              min="1"
              max="8"
              value={params.count}
              onChange={(e) => setParams({ ...params, count: parseInt(e.target.value) })}
              className="w-full accent-banana-500 h-2 bg-dark-bg rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1</span>
              <span>8</span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={isGenerating ? handleStop : handleGenerate}
          disabled={!prompt && !isGenerating}
          className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg shadow-banana-900/20 transition-all ${
            !prompt && !isGenerating
              ? 'bg-dark-surface text-gray-500 cursor-not-allowed'
              : isGenerating
                ? 'bg-red-500 hover:bg-red-400 text-black hover:scale-[1.02]'
                : 'bg-banana-500 hover:bg-banana-400 text-black hover:scale-[1.02]'
          }`}
        >
          {isGenerating ? (
            <span className="flex items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" /> 点击停止
            </span>
          ) : (
            `Generate ${params.count} Image${params.count > 1 ? 's' : ''}`
          )}
        </button>
      </div>

      {/* Right Display Grid */}
      <div className="lg:col-span-8">
        <ImageGrid
          images={generatedImages}
          slots={generatedSlots}
          isGenerating={isGenerating}
          params={params}
          onImageClick={onImageClick}
          onEdit={onEdit}
        />
      </div>
    </div>
  );
};
