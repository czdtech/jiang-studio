import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Settings, RefreshCw, Wand2, Plus, ChevronDown, X, Star, Trash2 } from 'lucide-react';
import {
  GeminiSettings,
  GeneratedImage,
  GenerationParams,
  ModelType,
  MODEL_PRESETS,
  ProviderDraft,
  ProviderProfile,
  ProviderScope,
} from '../types';
import { generateImages, optimizePrompt } from '../services/gemini';
import { useToast } from './Toast';
import { ImageGrid } from './ImageGrid';
import {
  deleteProvider as deleteProviderFromDb,
  getActiveProviderId as getActiveProviderIdFromDb,
  getDraft as getDraftFromDb,
  getProviders as getProvidersFromDb,
  setActiveProviderId as setActiveProviderIdInDb,
  upsertDraft as upsertDraftInDb,
  upsertProvider as upsertProviderInDb,
} from '../services/db';

interface GeminiPageProps {
  saveImage: (image: GeneratedImage) => Promise<void>;
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
}

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

const normalizeGeminiModel = (value: unknown): ModelType => {
  if (value === ModelType.NANO_BANANA_PRO) return ModelType.NANO_BANANA_PRO;
  if (value === ModelType.NANO_BANANA) return ModelType.NANO_BANANA;
  return ModelType.NANO_BANANA_PRO;
};

const createDefaultProvider = (): ProviderProfile => {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    scope: 'gemini',
    name: 'Gemini 官方',
    apiKey: '',
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    defaultModel: ModelType.NANO_BANANA_PRO,
    favorite: true,
    createdAt: now,
    updatedAt: now,
  };
};

export const GeminiPage = ({ saveImage, onImageClick, onEdit }: GeminiPageProps) => {
  const { showToast } = useToast();
  const scope: ProviderScope = 'gemini';

  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [activeProviderId, setActiveProviderIdState] = useState<string>('');

  const activeProvider = useMemo(() => (
    providers.find((p) => p.id === activeProviderId) || null
  ), [providers, activeProviderId]);

  const isHydratingRef = useRef(false);
  const hydratedProviderIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
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
        const def = createDefaultProvider();
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
  }, []);

  // Settings (Gemini)
  const [settings, setSettings] = useState<GeminiSettings>({
    apiKey: '',
    baseUrl: undefined,
  });

  // Generator State
  const [prompt, setPrompt] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);

  const [providerName, setProviderName] = useState<string>('');
  const [providerFavorite, setProviderFavorite] = useState<boolean>(false);

  // Params
  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    count: 1,
    model: ModelType.NANO_BANANA_PRO,
  });

  // Results
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);

  // 应用当前供应商配置 + 加载草稿（每个供应商一份）
  useEffect(() => {
    if (!activeProvider) return;
    // 避免 provider debounce 保存时触发“二次水合”，覆盖用户刚改的参数/模型
    if (hydratedProviderIdRef.current === activeProvider.id) return;
    hydratedProviderIdRef.current = activeProvider.id;

    let cancelled = false;
    isHydratingRef.current = true;

    setSettings({
      apiKey: activeProvider.apiKey,
      baseUrl: activeProvider.baseUrl === DEFAULT_GEMINI_BASE_URL ? undefined : activeProvider.baseUrl,
    });
    setProviderName(activeProvider.name);
    setProviderFavorite(!!activeProvider.favorite);

    const loadDraft = async () => {
      const draft = await getDraftFromDb(scope, activeProvider.id);
      if (cancelled) return;

      if (draft) {
        setPrompt(draft.prompt || '');
        setParams({
          ...draft.params,
          model: normalizeGeminiModel(draft.params?.model),
        });
        setRefImages(draft.refImages || []);
      } else {
        setPrompt('');
        setRefImages([]);

        const nextModel = normalizeGeminiModel(activeProvider.defaultModel);
        setParams({
          prompt: '',
          aspectRatio: '1:1',
          imageSize: '1K',
          count: 1,
          model: nextModel,
        });
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
  }, [activeProvider]);

  // 供应商配置持久化（名称/收藏/baseUrl/apiKey/默认模型）
  useEffect(() => {
    if (!activeProvider) return;
    if (isHydratingRef.current) return;

    const baseUrlToStore = settings.baseUrl || DEFAULT_GEMINI_BASE_URL;

    const next: ProviderProfile = {
      ...activeProvider,
      name: providerName || activeProvider.name,
      favorite: providerFavorite,
      apiKey: settings.apiKey,
      baseUrl: baseUrlToStore,
      defaultModel: String(params.model || activeProvider.defaultModel),
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
    params.model,
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
      model: String(params.model),
      updatedAt: Date.now(),
    };

    const t = window.setTimeout(() => {
      void upsertDraftInDb(draft).catch((e) => console.warn('Failed to save draft:', e));
    }, 350);

    return () => window.clearTimeout(t);
  }, [activeProvider, prompt, params, refImages]);

  const handleSelectProvider = async (nextId: string) => {
    setActiveProviderIdState(nextId);
    await setActiveProviderIdInDb(scope, nextId);
  };

  const handleCreateProvider = async () => {
    const base = activeProvider || createDefaultProvider();
    const now = Date.now();
    const created: ProviderProfile = {
      ...base,
      id: crypto.randomUUID(),
      name: base ? `复制 - ${base.name}` : '新供应商',
      favorite: false,
      createdAt: now,
      updatedAt: now,
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

  const handleOptimizePrompt = async () => {
    if (!prompt) return;
    const apiKey = settings.apiKey?.trim();
    if (!apiKey) {
      showToast('请先填写 Gemini API Key', 'error');
      return;
    }

    setIsOptimizing(true);
    try {
      const newPrompt = await optimizePrompt(prompt, {
        apiKey,
        baseUrl: settings.baseUrl || DEFAULT_GEMINI_BASE_URL,
      });
      setPrompt(newPrompt);
      showToast('Prompt enhanced successfully', 'success');
    } catch {
      showToast('Failed to enhance prompt', 'error');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (!prompt) return;
    const apiKey = settings.apiKey?.trim();
    if (!apiKey) {
      showToast('请先填写 Gemini API Key', 'error');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const runId = ++generationRunIdRef.current;

    setIsGenerating(true);
    try {
      const currentParams: GenerationParams = {
        ...params,
        prompt,
        referenceImages: refImages,
        model: normalizeGeminiModel(params.model),
      };
      const results = await generateImages(
        currentParams,
        {
          apiKey,
          baseUrl: settings.baseUrl || DEFAULT_GEMINI_BASE_URL,
        },
        { signal: controller.signal }
      );
      if (!isMountedRef.current) return;
      if (generationRunIdRef.current !== runId) return;
      const withSource = results.map((img) => ({
        ...img,
        sourceScope: scope,
        sourceProviderId: activeProviderId,
      }));
      setGeneratedImages(withSource);
      // Auto save to portfolio
      for (const img of withSource) {
        await saveImage(img);
      }
      showToast(`Generated ${withSource.length} image${withSource.length > 1 ? 's' : ''}`, 'success');
    } catch (error) {
      if (!isMountedRef.current) return;
      if (generationRunIdRef.current !== runId) return;

      const aborted = (error as any)?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        showToast('已停止生成', 'info');
        return;
      }

      showToast('Generation Error: ' + (error instanceof Error ? error.message : 'Unknown'), 'error');
    } finally {
      if (!isMountedRef.current) return;
      if (generationRunIdRef.current !== runId) return;
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (!isGenerating) return;
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
            <Settings className="w-4 h-4" /> Gemini Settings
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
                placeholder="AIza..."
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Base URL (Optional)</label>
              <input
                type="text"
                value={settings.baseUrl || ''}
                onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value || undefined }))}
                placeholder={DEFAULT_GEMINI_BASE_URL}
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
              />
              <p className="text-xs text-gray-500 mt-1">留空将使用默认官方地址；只有在你有反代/自建网关时才需要填写。</p>
            </div>
          </div>
        </div>

        {/* Prompt Input */}
        <div className="bg-dark-surface p-5 rounded-xl border border-dark-border shadow-lg">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-bold text-gray-300">Prompt</label>
            <button
              onClick={handleOptimizePrompt}
              disabled={isOptimizing || !prompt}
              className="flex items-center gap-1 text-xs text-banana-500 hover:text-banana-400 disabled:opacity-50"
            >
              <Wand2 className="w-3 h-3" /> {isOptimizing ? 'Optimizing...' : 'Enhance Prompt'}
            </button>
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
                <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-dark-border">
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
        </div>

        {/* Parameters */}
        <div className="bg-dark-surface p-5 rounded-xl border border-dark-border shadow-lg space-y-5">
          {/* Model Selection */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Model</label>
            <div className="relative">
              <select
                value={params.model}
                onChange={(e) => setParams({ ...params, model: normalizeGeminiModel(e.target.value) })}
                className="w-full appearance-none bg-dark-bg border border-dark-border rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer"
              >
                {MODEL_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label} ({preset.desc})
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Aspect Ratio */}
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

          {/* Resolution (Pro only) */}
          {params.model === ModelType.NANO_BANANA_PRO && (
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
          isGenerating={isGenerating}
          params={params}
          onImageClick={onImageClick}
          onEdit={onEdit}
        />
      </div>
    </div>
  );
};
