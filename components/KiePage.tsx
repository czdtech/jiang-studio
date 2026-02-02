import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plug, RefreshCw, Plus, X, Star, Trash2, ChevronDown, Sparkles, Image as ImageIcon } from 'lucide-react';
import { GeneratedImage, GenerationParams, ModelType, PromptOptimizerConfig, ProviderDraft, ProviderProfile, ProviderScope } from '../types';
import { generateImages, KieSettings } from '../services/kie';
import { optimizeUserPrompt } from '../services/mcp';
import { useToast } from './Toast';
import { ImageGrid, ImageGridSlot } from './ImageGrid';
import { PromptOptimizerSettings } from './PromptOptimizerSettings';
import { IterationAssistant } from './IterationAssistant';
import { SamplePromptChips } from './SamplePromptChips';
import {
  getGenerateButtonStyles,
  getCountButtonStyles,
  getFavoriteButtonStyles,
  getRefImageButtonStyles,
  inputBaseStyles,
  textareaBaseStyles,
  selectBaseStyles,
  selectSmallStyles,
} from './uiStyles';
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
  const generateLockRef = useRef(false);
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
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState('nano-banana-pro');

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

  const handleOptimizePrompt = async () => {
    if (!prompt.trim()) return;
    if (!optimizerConfig?.enabled) return;

    setIsOptimizing(true);
    try {
      const newPrompt = await optimizeUserPrompt(prompt);
      setPrompt(newPrompt);
      showToast('提示词已优化', 'success');
    } catch (err) {
      showToast('提示词优化失败：' + (err instanceof Error ? err.message : '未知错误'), 'error');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleGenerate = async () => {
    if (generateLockRef.current) return;
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

    generateLockRef.current = true;
    setIsGenerating(true);

    // 自动模式：先优化提示词
    let finalPrompt = prompt;
    if (optimizerConfig?.enabled && optimizerConfig.mode === 'auto') {
      try {
        finalPrompt = await optimizeUserPrompt(prompt);
        setPrompt(finalPrompt);
        showToast('提示词已自动优化', 'info');
      } catch (err) {
        // 优化失败，询问是否继续
        const shouldContinue = window.confirm(
          `提示词优化失败：${err instanceof Error ? err.message : '未知错误'}\n\n是否使用原始提示词继续生成？`
        );
        if (!shouldContinue) {
          generateLockRef.current = false;
          setIsGenerating(false);
          return;
        }
      }
    }

    try {
      const currentParams: GenerationParams = {
        ...params,
        prompt: finalPrompt,
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
      showToast('生成错误：' + (e instanceof Error ? e.message : '未知错误'), 'error');
    } finally {
      if (generationRunIdRef.current === runId) generateLockRef.current = false;
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

  const canGenerate =
    !!prompt.trim() && !!settings.apiKey.trim() && !!settings.baseUrl.trim() && !!customModel.trim();

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
    <div className="h-full flex flex-col">
      {/* 上区：左侧配置 + 右侧图片展示 */}
      <div className="flex-1 min-h-0 p-4 flex flex-col md:flex-row gap-4">
        {/* 左侧：API 配置 */}
        <div className="w-full md:w-[280px] md:shrink-0 max-h-[40vh] md:max-h-none border border-dark-border rounded-xl bg-dark-surface/80 backdrop-blur-sm p-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-1.5">
            <Plug className="w-4 h-4 text-banana-500" />
            <span className="text-sm font-medium text-white">Kie AI 设置</span>
          </div>

          {/* 供应商选择 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">供应商</label>
            <select
              value={activeProviderId}
              onChange={(e) => void handleSelectProvider(e.target.value)}
              className={selectBaseStyles}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.favorite ? '★ ' : '') + p.name}
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
                className={getFavoriteButtonStyles(providerFavorite)}
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
              onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="API Key"
              className={inputBaseStyles}
            />
            {!settings.apiKey.trim() && (
              <p className="text-xs text-yellow-500/80">未填写 API Key，生成/增强将不可用。</p>
            )}
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">Base URL</label>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={(e) => setSettings((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://api.kie.ai"
              className={inputBaseStyles}
            />
            {!settings.baseUrl.trim() && (
              <p className="text-xs text-yellow-500/80">未填写 Base URL，生成/增强将不可用。</p>
            )}
          </div>

          {/* Prompt 优化器配置（内联） */}
          <PromptOptimizerSettings
            onConfigChange={handleOptimizerConfigChange}
            currentPrompt={prompt}
            onOptimize={handleOptimizePrompt}
            isOptimizing={isOptimizing}
          />
        </div>

        {/* 中间：图片展示 */}
        <div className="flex-1 min-w-0 overflow-auto">
          <ImageGrid
            images={generatedImages}
            slots={generatedSlots}
            isGenerating={isGenerating}
            params={params}
            onImageClick={onImageClick}
            onEdit={onEdit}
          />
        </div>

        {/* 右侧：迭代助手 */}
        <IterationAssistant
          currentPrompt={prompt}
          onUseVersion={setPrompt}
        />
      </div>

      {/* 下区：Prompt + 参数 + 生成（全宽） */}
      <div className="shrink-0 px-4 pb-4">
        <div className="border border-dark-border rounded-xl bg-dark-surface/80 backdrop-blur-sm p-4">
          <div className="flex flex-col lg:flex-row items-stretch gap-4 w-full overflow-hidden">
            {/* Prompt */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-500">提示词</span>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="描述你的想法…"
                className={textareaBaseStyles}
              />
              {!prompt.trim() && <SamplePromptChips onPick={setPrompt} />}
            </div>

            {/* 参数区 */}
            <div className="w-full lg:w-[320px] lg:shrink-0 flex flex-col gap-2">
              {/* Model + Ratio + Size */}
              <div className="grid grid-cols-[minmax(0,1fr)_76px_76px] gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">模型</label>
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="nano-banana-pro"
                    className="w-full h-8 text-xs bg-dark-bg border border-dark-border rounded-lg px-2 text-white outline-none focus:ring-1 focus:ring-banana-500 placeholder-gray-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">比例</label>
                  <div className="relative">
                    <select
                      value={params.aspectRatio}
                      onChange={(e) => setParams((prev) => ({ ...prev, aspectRatio: e.target.value as GenerationParams['aspectRatio'] }))}
                      className={selectSmallStyles}
                    >
                      {aspectRatioOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
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
                      onChange={(e) => setParams((prev) => ({ ...prev, imageSize: e.target.value as GenerationParams['imageSize'] }))}
                      className={selectSmallStyles}
                    >
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                    </select>
                    <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Output + Count + 参考图 */}
              <div className="flex items-center gap-2">
                <div className="w-16">
                  <label className="text-xs text-gray-500 mb-1 block">格式</label>
                  <div className="relative">
                    <select
                      value={params.outputFormat || 'png'}
                      onChange={(e) => setParams((prev) => ({ ...prev, outputFormat: e.target.value as NonNullable<GenerationParams['outputFormat']> }))}
                      className="w-full h-8 text-xs bg-dark-bg border border-dark-border rounded-lg px-2 pr-5 text-white outline-none focus:ring-1 focus:ring-banana-500 cursor-pointer appearance-none"
                    >
                      <option value="png">png</option>
                      <option value="jpg">jpg</option>
                    </select>
                    <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">数量</label>
                  <div className="grid grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        onClick={() => setParams((prev) => ({ ...prev, count: n }))}
                        className={getCountButtonStyles(params.count === n)}
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
                    className={getRefImageButtonStyles(refImages.length > 0)}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span className="text-xs">{refImages.length}/8</span>
                  </button>
                  {/* 参考图弹出层 */}
                  {showRefPopover && (
                    <div className="absolute bottom-full right-0 mb-2 w-64 bg-dark-surface border border-dark-border rounded-lg p-3 shadow-xl z-10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-400">参考图 ({refImages.length}/8)</span>
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
                className={getGenerateButtonStyles(canGenerate, isGenerating)}
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
