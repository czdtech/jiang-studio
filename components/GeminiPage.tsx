import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, RefreshCw, Wand2, Plus, ChevronDown, X, Star, Trash2, Sparkles, Image as ImageIcon } from 'lucide-react';
import {
  GeminiSettings,
  GeneratedImage,
  GenerationParams,
  ModelType,
  MODEL_PRESETS,
  ProviderDraft,
  ProviderProfile,
  ProviderScope,
  PromptOptimizerConfig,
} from '../types';
import { generateImages, optimizePrompt as optimizePromptGemini } from '../services/gemini';
import { optimizePrompt as optimizePromptOpenAI } from '../services/openai';
import { useToast } from './Toast';
import { ImageGrid } from './ImageGrid';
import { PromptOptimizerSettings } from './PromptOptimizerSettings';
import { SamplePromptChips } from './SamplePromptChips';
import {
  deleteProvider as deleteProviderFromDb,
  getActiveProviderId as getActiveProviderIdFromDb,
  getDraft as getDraftFromDb,
  getPromptOptimizerConfig,
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

  // 参考图弹出层
  const [showRefPopover, setShowRefPopover] = useState(false);

  // 独立的 Prompt 优化器配置
  const [optimizerConfig, setOptimizerConfig] = useState<PromptOptimizerConfig | null>(null);

  // 初始化加载独立优化器配置
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const config = await getPromptOptimizerConfig();
      if (cancelled) return;
      if (config?.enabled) {
        setOptimizerConfig(config);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const handleOptimizerConfigChange = useCallback((config: PromptOptimizerConfig | null) => {
    setOptimizerConfig(config);
  }, []);

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
  const [optimizerModel, setOptimizerModel] = useState<'gemini-2.5-flash' | 'gemini-3-flash-preview'>('gemini-2.5-flash');

  const [providerName, setProviderName] = useState<string>('');
  const [providerFavorite, setProviderFavorite] = useState<boolean>(false);

  // Params
  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    count: 1,
    model: ModelType.NANO_BANANA,
  });

  // Results
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);

  // 应用当前供应商配置 + 加载草稿
  useEffect(() => {
    if (!activeProvider) return;
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

  // 供应商配置持久化
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

  // 草稿持久化
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
    if (!prompt.trim()) return;

    // 优先使用独立配置
    if (optimizerConfig?.enabled) {
      if (!optimizerConfig.apiKey) {
        showToast('请先在优化器设置中填写 API Key', 'error');
        return;
      }
      if (!optimizerConfig.baseUrl) {
        showToast('请先在优化器设置中填写 Base URL', 'error');
        return;
      }
      if (!optimizerConfig.model.trim()) {
        showToast('请先在优化器设置中填写模型名', 'error');
        return;
      }

      setIsOptimizing(true);
      try {
        const newPrompt = await optimizePromptOpenAI(
          prompt,
          { apiKey: optimizerConfig.apiKey, baseUrl: optimizerConfig.baseUrl },
          optimizerConfig.model
        );
        setPrompt(newPrompt);
        showToast('提示词已增强', 'success');
      } catch (err) {
        showToast('提示词增强失败：' + (err instanceof Error ? err.message : '未知错误'), 'error');
      } finally {
        setIsOptimizing(false);
      }
      return;
    }

    const apiKey = settings.apiKey?.trim();
    if (!apiKey) {
      showToast('请先填写 Gemini API Key', 'error');
      return;
    }

    setIsOptimizing(true);
    try {
      const newPrompt = await optimizePromptGemini(prompt, {
        apiKey,
        baseUrl: settings.baseUrl || DEFAULT_GEMINI_BASE_URL,
      }, optimizerModel);
      setPrompt(newPrompt);
      showToast('提示词已增强', 'success');
    } catch (err) {
      showToast('提示词增强失败：' + (err instanceof Error ? err.message : '未知错误'), 'error');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (!prompt.trim()) return;
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
      for (const img of withSource) {
        await saveImage(img);
      }
      showToast(`生成完成：${withSource.length} 张`, 'success');
    } catch (error) {
      if (!isMountedRef.current) return;
      if (generationRunIdRef.current !== runId) return;

      const aborted = (error as any)?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        showToast('已停止生成', 'info');
        return;
      }

      showToast('生成错误：' + (error instanceof Error ? error.message : '未知错误'), 'error');
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
          const maxImages = params.model === ModelType.NANO_BANANA_PRO ? 14 : 4;
          setRefImages((prev) => [...prev, ...newImages].slice(0, maxImages));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeRefImage = (index: number) => {
    setRefImages((prev) => prev.filter((_, i) => i !== index));
  };

  const maxRefImages = params.model === ModelType.NANO_BANANA_PRO ? 14 : 4;
  const canGenerate = !!prompt.trim() && !!settings.apiKey.trim();

  return (
    <div className="h-full flex flex-col">
      {/* 上区：左侧配置 + 右侧图片展示 */}
      <div className="flex-1 min-h-0 p-4 flex flex-col md:flex-row gap-4">
        {/* 左侧：API 配置 */}
        <div className="w-full md:w-[280px] md:shrink-0 max-h-[40vh] md:max-h-none border border-dark-border rounded-xl bg-dark-surface/80 backdrop-blur-sm p-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-1.5">
            <Settings className="w-4 h-4 text-banana-500" />
            <span className="text-sm font-medium text-white">Gemini 设置</span>
          </div>

          {/* 供应商选择 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">供应商</label>
            <select
              value={activeProviderId}
              onChange={(e) => void handleSelectProvider(e.target.value)}
              className="w-full h-9 text-sm bg-dark-bg border border-dark-border rounded-lg px-3 text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.favorite ? '★ ' : '') + (p.name || p.id)}
                </option>
              ))}
            </select>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void handleCreateProvider()}
                className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg border border-dark-border bg-dark-bg text-gray-400 hover:text-white hover:border-gray-600 transition-colors text-xs"
                title="新增供应商"
              >
                <Plus className="w-3.5 h-3.5" />
                新增
              </button>
              <button
                type="button"
                onClick={handleToggleFavorite}
                className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-colors ${
                  providerFavorite
                    ? 'border-banana-500/70 bg-banana-500/10 text-banana-400'
                    : 'border-dark-border bg-dark-bg text-gray-400 hover:text-white hover:border-gray-600'
                }`}
                title="收藏"
                aria-label={providerFavorite ? '取消收藏供应商' : '收藏供应商'}
              >
                <Star className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteProvider()}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-dark-border bg-dark-bg text-gray-400 hover:text-red-400 hover:border-red-500/50 transition-colors"
                title="删除供应商"
                aria-label="删除供应商"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">API Key</label>
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
              placeholder="AIza..."
              className="w-full h-9 text-sm bg-dark-bg border border-dark-border rounded-lg px-3 text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-banana-500"
            />
            {!settings.apiKey.trim() && (
              <p className="text-xs text-yellow-500/80">
                未填写 API Key，无法生成/增强；请先配置后再开始。
              </p>
            )}
          </div>

          {/* Prompt 优化器配置（内联） */}
          <PromptOptimizerSettings onConfigChange={handleOptimizerConfigChange} />
        </div>

        {/* 右侧：图片展示 */}
        <div className="flex-1 min-w-0 overflow-auto">
          <ImageGrid
            images={generatedImages}
            isGenerating={isGenerating}
            params={params}
            onImageClick={onImageClick}
            onEdit={onEdit}
          />
        </div>
      </div>

      {/* 下区：Prompt + 参数 + 生成（全宽） */}
      <div className="shrink-0 px-4 pb-4">
        <div className="border border-dark-border rounded-xl bg-dark-surface/80 backdrop-blur-sm p-4">
          <div className="flex flex-col lg:flex-row items-stretch gap-4 w-full overflow-hidden">
            {/* Prompt */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">提示词</span>
                <div className="flex items-center gap-2">
                  <select
                    value={optimizerModel}
                    onChange={(e) => setOptimizerModel(e.target.value as 'gemini-2.5-flash' | 'gemini-3-flash-preview')}
                    className="text-xs bg-dark-bg border border-dark-border rounded px-1.5 py-0.5 text-gray-400 cursor-pointer"
                  >
                    <option value="gemini-2.5-flash">2.5-flash</option>
                    <option value="gemini-3-flash-preview">3-flash</option>
                  </select>
                  <button
                    onClick={handleOptimizePrompt}
                    disabled={isOptimizing || !prompt}
                    className="flex items-center gap-1 text-xs text-banana-500 hover:text-banana-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Wand2 className="w-3 h-3" />
                    {isOptimizing ? '优化中…' : '增强'}
                  </button>
                </div>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="描述你的想法…"
                className="flex-1 min-h-[80px] resize-none text-sm bg-dark-bg border border-dark-border rounded-lg p-3 text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-banana-500"
              />
              {!prompt.trim() && <SamplePromptChips onPick={setPrompt} />}
            </div>

            {/* 参数区 */}
            <div className="w-full lg:w-[320px] lg:shrink-0 flex flex-col gap-2">
              {/* Model + Ratio + Size */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">模型</label>
                  <div className="relative">
                    <select
                      value={params.model}
                      onChange={(e) => setParams({ ...params, model: normalizeGeminiModel(e.target.value) })}
                      className="w-full h-8 text-xs bg-dark-bg border border-dark-border rounded-lg px-2 pr-6 text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer appearance-none"
                    >
                      {MODEL_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">比例</label>
                  <div className="relative">
                    <select
                      value={params.aspectRatio}
                      onChange={(e) => setParams({ ...params, aspectRatio: e.target.value as GenerationParams['aspectRatio'] })}
                      className="w-full h-8 text-xs bg-dark-bg border border-dark-border rounded-lg px-2 pr-6 text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer appearance-none"
                    >
                      {['1:1', '16:9', '9:16', '4:3', '3:4'].map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">尺寸</label>
                  <div className="relative">
                    <select
                      value={params.imageSize}
                      onChange={(e) => setParams({ ...params, imageSize: e.target.value as GenerationParams['imageSize'] })}
                      className="w-full h-8 text-xs bg-dark-bg border border-dark-border rounded-lg px-2 pr-6 text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer appearance-none"
                      disabled={params.model !== ModelType.NANO_BANANA_PRO}
                    >
                      {['1K', '2K', '4K'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Count + 参考图 */}
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">数量</label>
                  <div className="grid grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        onClick={() => setParams({ ...params, count: n })}
                        className={`h-8 text-xs rounded-lg border transition-colors ${
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
                {/* 参考图按钮 */}
                <div className="relative">
                  <label className="text-xs text-gray-500 mb-1 block">参考图</label>
                  <button
                    onClick={() => setShowRefPopover(!showRefPopover)}
                    className={`h-8 px-3 flex items-center gap-1.5 rounded-lg border transition-colors ${
                      refImages.length > 0
                        ? 'bg-banana-500/10 border-banana-500/30 text-banana-400'
                        : 'bg-dark-bg border-dark-border text-gray-400 hover:text-white hover:border-gray-600'
                    }`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span className="text-xs">{refImages.length}/{maxRefImages}</span>
                  </button>
                  {/* 参考图弹出层 */}
                  {showRefPopover && (
                    <div className="absolute bottom-full right-0 mb-2 w-64 bg-dark-surface border border-dark-border rounded-lg p-3 shadow-xl z-10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-400">参考图 ({refImages.length}/{maxRefImages})</span>
                        <button
                          type="button"
                          aria-label="关闭参考图"
                          onClick={() => setShowRefPopover(false)}
                          className="text-gray-500 hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {refImages.length > 0 && (
                        <div className="grid grid-cols-4 gap-1.5 mb-2">
                          {refImages.map((img, idx) => (
                            <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-dark-border group">
                              <img src={img} alt={`Ref ${idx}`} className="w-full h-full object-cover" />
                              <button
                                onClick={() => removeRefImage(idx)}
                                aria-label="移除参考图"
                                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                              >
                                <X className="w-3 h-3 text-white" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <label className="flex items-center justify-center h-8 text-xs text-gray-400 hover:text-white border border-dashed border-dark-border hover:border-banana-500/50 rounded-lg cursor-pointer transition-colors">
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        添加参考图
                        <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 生成按钮 */}
            <div className="w-full lg:w-[100px] lg:shrink-0 flex items-center">
              <button
                onClick={isGenerating ? handleStop : handleGenerate}
                disabled={!isGenerating && !canGenerate}
                className={`w-full h-full min-h-[80px] rounded-xl font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                  !canGenerate && !isGenerating
                    ? 'bg-dark-bg text-gray-500 cursor-not-allowed border border-dark-border'
                    : isGenerating
                      ? 'bg-red-500 hover:bg-red-400 text-black'
                      : 'bg-banana-500 hover:bg-banana-400 text-black shadow-lg shadow-banana-500/20'
                }`}
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span className="text-xs">停止</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span className="text-sm">生成</span>
                    <span className="text-xs opacity-70">×{params.count}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
