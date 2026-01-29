import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plug, RefreshCw, Wand2, Plus, X, Star, Trash2 } from 'lucide-react';
import { GeneratedImage, GenerationParams, ModelType, ProviderDraft, ProviderProfile, ProviderScope } from '../types';
import { generateImages, KieSettings } from '../services/kie';
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

interface KiePageProps {
  saveImage: (image: GeneratedImage) => Promise<void>;
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
}

const createDefaultProvider = (): ProviderProfile => {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    scope: 'kie',
    name: 'Kie AI',
    apiKey: '',
    baseUrl: 'https://api.kie.ai',
    defaultModel: 'nano-banana-pro',
    favorite: true,
    createdAt: now,
    updatedAt: now,
  };
};

export const KiePage = ({ saveImage, onImageClick, onEdit }: KiePageProps) => {
  const { showToast } = useToast();
  const scope: ProviderScope = 'kie';

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

  // Settings
  const [settings, setSettings] = useState<KieSettings>({ apiKey: '', baseUrl: 'https://api.kie.ai' });
  const [providerName, setProviderName] = useState<string>('');
  const [providerFavorite, setProviderFavorite] = useState<boolean>(false);

  // Generator State
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState('nano-banana-pro');

  // Params
  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    outputFormat: 'png',
    count: 1,
    model: ModelType.CUSTOM,
  });

  // Results
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [generatedSlots, setGeneratedSlots] = useState<ImageGridSlot[]>([]);

  // 应用当前供应商配置 + 加载草稿（每个供应商一份）
  useEffect(() => {
    if (!activeProvider) return;
    if (hydratedProviderIdRef.current === activeProvider.id) return;
    hydratedProviderIdRef.current = activeProvider.id;

    let cancelled = false;
    isHydratingRef.current = true;

    setSettings({ apiKey: activeProvider.apiKey, baseUrl: activeProvider.baseUrl });
    setProviderName(activeProvider.name);
    setProviderFavorite(!!activeProvider.favorite);

    const loadDraft = async () => {
      const draft = await getDraftFromDb(scope, activeProvider.id);
      if (cancelled) return;

      if (draft) {
        setPrompt(draft.prompt || '');
        setParams({
          ...draft.params,
          model: ModelType.CUSTOM,
          outputFormat: draft.params?.outputFormat || 'png',
        });
        setRefImages(draft.refImages || []);
        setCustomModel(draft.model || activeProvider.defaultModel || 'nano-banana-pro');
      } else {
        setPrompt('');
        setRefImages([]);
        setParams({
          prompt: '',
          aspectRatio: '1:1',
          imageSize: '1K',
          outputFormat: 'png',
          count: 1,
          model: ModelType.CUSTOM,
        });
        setCustomModel(activeProvider.defaultModel || 'nano-banana-pro');
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

  // 供应商配置持久化
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
      updatedAt: Date.now(),
    };

    const t = window.setTimeout(() => {
      void upsertProviderInDb(next).catch((e) => console.warn('Failed to save provider:', e));
      setProviders((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    }, 300);

    return () => window.clearTimeout(t);
  }, [activeProvider, providerName, providerFavorite, settings.apiKey, settings.baseUrl, customModel]);

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
  }, [activeProvider, prompt, params, refImages, customModel]);

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

  const handleToggleFavorite = () => setProviderFavorite((v) => !v);

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (!prompt.trim()) return;
    if (!settings.apiKey) {
      showToast('请先填写 API Key', 'error');
      return;
    }
    if (!settings.baseUrl) {
      showToast('请先填写 Base URL', 'error');
      return;
    }
    const model = customModel.trim();
    if (!model) {
      showToast('请先填写模型名', 'error');
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
        model: model as ModelType,
      };

      const slotIds = Array.from({ length: currentParams.count }, () => crypto.randomUUID());
      setGeneratedImages([]);
      setGeneratedSlots(slotIds.map((id) => ({ id, status: 'pending' })));

      const outcomes = await generateImages(currentParams, settings, { signal: controller.signal });
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

      for (const img of successImages) {
        await saveImage(img);
      }

      const successCount = successImages.length;
      const failCount = currentParams.count - successCount;
      if (controller.signal.aborted) {
        showToast(successCount > 0 ? `已停止生成（已生成 ${successCount} 张）` : '已停止生成', 'info');
      } else if (successCount === 0) {
        showToast('生成失败（请查看失败卡片）', 'error');
      } else if (failCount > 0) {
        showToast('生成完成（部分失败，请查看卡片）', 'info');
      } else {
        showToast('生成完成', 'success');
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      if (generationRunIdRef.current !== runId) return;

      const aborted = (e as any)?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        setGeneratedSlots((prev) =>
          prev.map((s) => (s.status === 'pending' ? { id: s.id, status: 'error', error: '已停止' } : s))
        );
        showToast('已停止生成', 'info');
        return;
      }
      showToast('生成错误：' + (e instanceof Error ? e.message : 'Unknown'), 'error');
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
    for (let i = 0; i < fileList.length; i++) files.push(fileList[i]);

    const newImages: string[] = [];
    let processedCount = 0;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') newImages.push(reader.result);
        processedCount++;
        if (processedCount === files.length) {
          setRefImages((prev) => [...prev, ...newImages].slice(0, 8));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeRefImage = (index: number) => {
    setRefImages((prev) => prev.filter((_, i) => i !== index));
  };

  const aspectRatioOptions: Array<{ value: GenerationParams['aspectRatio']; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: '1:1', label: '1:1' },
    { value: '2:3', label: '2:3' },
    { value: '3:2', label: '3:2' },
    { value: '4:5', label: '4:5' },
    { value: '5:4', label: '5:4' },
    { value: '9:16', label: '9:16' },
    { value: '16:9', label: '16:9' },
    { value: '21:9', label: '21:9' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Left Controls */}
      <div className="lg:col-span-4 space-y-6">
        <div className="bg-dark-surface p-5 rounded-xl border border-dark-border shadow-lg">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Plug className="w-4 h-4" /> Kie AI Settings
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">供应商</label>
              <div className="flex gap-2">
                <select
                  value={activeProviderId}
                  onChange={(e) => void handleSelectProvider(e.target.value)}
                  className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.favorite ? '★ ' : ''}
                      {p.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => void handleCreateProvider()}
                  className="p-2 bg-dark-bg border border-dark-border rounded-lg hover:bg-dark-border transition-colors"
                  title="复制供应商"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={handleToggleFavorite}
                  className={`p-2 border rounded-lg transition-colors ${
                    providerFavorite
                      ? 'bg-banana-500/10 border-banana-500/30 text-banana-400'
                      : 'bg-dark-bg border-dark-border hover:bg-dark-border text-gray-300'
                  }`}
                  title="收藏"
                >
                  <Star className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void handleDeleteProvider()}
                  className="p-2 bg-dark-bg border border-dark-border rounded-lg hover:bg-dark-border transition-colors text-red-300"
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
                placeholder="例如：Kie 主账号"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key</label>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder="YOUR_API_KEY"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Base URL</label>
              <input
                type="text"
                value={settings.baseUrl}
                onChange={(e) => setSettings((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="https://api.kie.ai"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
              />
            </div>
          </div>
        </div>

        {/* Prompt */}
        <div className="bg-dark-surface p-5 rounded-xl border border-dark-border shadow-lg">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Wand2 className="w-4 h-4" /> Prompt
          </h3>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入提示词..."
            className="w-full h-28 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600 resize-none"
          />

          {/* Params */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Model</label>
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="nano-banana-pro"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Aspect Ratio</label>
              <select
                value={params.aspectRatio}
                onChange={(e) =>
                  setParams((prev) => ({ ...prev, aspectRatio: e.target.value as GenerationParams['aspectRatio'] }))
                }
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none"
              >
                {aspectRatioOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Resolution</label>
              <select
                value={params.imageSize}
                onChange={(e) =>
                  setParams((prev) => ({ ...prev, imageSize: e.target.value as GenerationParams['imageSize'] }))
                }
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none"
              >
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Output</label>
              <select
                value={params.outputFormat || 'png'}
                onChange={(e) =>
                  setParams((prev) => ({
                    ...prev,
                    outputFormat: e.target.value as NonNullable<GenerationParams['outputFormat']>,
                  }))
                }
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-banana-500 outline-none"
              >
                <option value="png">png</option>
                <option value="jpg">jpg</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Count</label>
              <div className="grid grid-cols-4 gap-1">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setParams((prev) => ({ ...prev, count: n }))}
                    className={`py-2 text-sm rounded-lg border transition-colors ${
                      params.count === n
                        ? 'bg-banana-500/10 border-banana-500/30 text-banana-400'
                        : 'bg-dark-bg border-dark-border text-gray-300 hover:bg-dark-border'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Reference Images */}
          <div className="mt-4">
            <label className="block text-xs text-gray-500 mb-2">Reference Images（可选，最多 8 张）</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {refImages.map((img, index) => (
                <div key={index} className="relative w-16 h-16">
                  <img src={img} alt={`ref-${index}`} className="w-16 h-16 object-cover rounded-lg border border-dark-border" />
                  <button
                    onClick={() => removeRefImage(index)}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileUpload}
              className="w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-dark-bg file:text-white hover:file:bg-dark-border"
            />
            <p className="mt-2 text-xs text-gray-500">
              Kie 的 <span className="text-gray-300">image_input</span> 只接受 URL；本地图片会先自动上传为 URL（用于图生图/参考图）。
            </p>
          </div>

          {/* Generate Button */}
          <button
            onClick={isGenerating ? handleStop : handleGenerate}
            disabled={!prompt.trim() || !settings.apiKey || !settings.baseUrl || !customModel.trim()}
            className={`mt-5 w-full py-3 rounded-xl font-bold transition-all transform ${
              (!prompt.trim() || !settings.apiKey || !settings.baseUrl || !customModel.trim()) && !isGenerating
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
