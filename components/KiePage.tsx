import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plug, RefreshCw, Plus, X, Star, Trash2, ChevronDown, ChevronRight, Sparkles, Image as ImageIcon, Wand2, FolderOpen, History } from 'lucide-react';
import { GeneratedImage, GenerationParams, ModelType, PromptOptimizerConfig, ProviderDraft, ProviderProfile, ProviderScope, BatchConfig, IterationContext, IterationMode } from '../types';
import { generateImages, KieSettings } from '../services/kie';
import { optimizeUserPrompt } from '../services/mcp';
import { useToast } from './Toast';
import { ImageGrid, ImageGridSlot } from './ImageGrid';
import { BatchImageGrid } from './BatchImageGrid';
import { PromptOptimizerSettings } from './PromptOptimizerSettings';
import { IterationAssistant } from './IterationAssistant';
import { RefImageRow } from './RefImageRow';
import { SamplePromptChips } from './SamplePromptChips';
import { PortfolioPicker } from './PortfolioPicker';
import {
  getFavoriteButtonStyles,
  getRefImageButtonStyles,
  inputBaseStyles,
  selectBaseStyles,
  selectSmallStyles,
} from './uiStyles';
import {
  deleteProvider as deleteProviderFromDb,
  getActiveProviderId as getActiveProviderIdFromDb,
  getDraft as getDraftFromDb,
  getPromptOptimizerConfig,
  setPromptOptimizerConfig,
  getProviders as getProvidersFromDb,
  getRecentImagesByScope,
  setActiveProviderId as setActiveProviderIdInDb,
  upsertDraft as upsertDraftInDb,
  upsertProvider as upsertProviderInDb,
} from '../services/db';
import { useBatchGenerator } from '../hooks/useBatchGenerator';
import { parsePromptsToBatch, MAX_BATCH_TOTAL } from '../services/batch';

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
    defaultModel: 'google/nano-banana',
    favorite: true,
    createdAt: now,
    updatedAt: now,
  };
};

const MAX_REF_IMAGES = 8;

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
  const deletingProviderIdRef = useRef<string | null>(null); // 标记正在删除的供应商

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
  const [customModel, setCustomModel] = useState('google/nano-banana');

  // 迭代助手：图片上下文
  const [iterationMode, setIterationMode] = useState<IterationMode>('prompt-only');
  const [iterationContext, setIterationContext] = useState<IterationContext | undefined>();

  const handleIterate = useCallback((image: GeneratedImage, index: number, allImages: GeneratedImage[]) => {
    setIterationMode('image-context');
    setIterationContext({
      targetImage: image,
      targetPrompt: image.prompt,
      allImages,
      selectedImageIndex: index,
    });
  }, []);

  const handleClearIterationContext = useCallback(() => {
    setIterationMode('prompt-only');
    setIterationContext(undefined);
  }, []);

  const handleSwitchTarget = useCallback((image: GeneratedImage, index: number) => {
    setIterationContext(prev => prev ? {
      ...prev,
      targetImage: image,
      targetPrompt: image.prompt,
      selectedImageIndex: index,
    } : undefined);
  }, []);

  // 参考图弹出层
  const [showRefPopover, setShowRefPopover] = useState(false);
  const [showMobilePortfolio, setShowMobilePortfolio] = useState(false);
  const portfolioTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Kie AI 预设模型列表（Kie AI 不支持 /v1/models 端点）
  // 参考: https://kie.ai/nano-banana, https://kie.ai/nano-banana-pro, https://kie.ai/google/imagen4
  const KIE_PRESET_MODELS = [
    // Nano Banana 系列
    { id: 'google/nano-banana', label: 'Nano Banana（Gemini 2.5 Flash 文生图）' },
    { id: 'google/nano-banana-edit', label: 'Nano Banana Edit（图片编辑）' },
    { id: 'nano-banana-pro', label: 'Nano Banana Pro（Gemini 3 Pro 高质量）' },
    // Imagen 4 系列
    { id: 'google/imagen4', label: 'Imagen 4（平衡质量与速度）' },
    { id: 'google/imagen4-ultra', label: 'Imagen 4 Ultra（超快 2K 高清）' },
    { id: 'google/imagen4-fast', label: 'Imagen 4 Fast（快速生成）' },
  ];

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

  const handleIterateTemplateChange = useCallback((templateId: string) => {
    if (optimizerConfig) {
      const newConfig = { ...optimizerConfig, iterateTemplateId: templateId, updatedAt: Date.now() };
      setOptimizerConfig(newConfig);
      void setPromptOptimizerConfig(newConfig);
    }
  }, [optimizerConfig]);

  // Params
  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    outputFormat: 'png',
    count: 1,
    model: ModelType.CUSTOM,
  });

  // Results: 本轮生成 + 历史记录（折叠）
  const [currentImages, setCurrentImages] = useState<GeneratedImage[]>([]);
  const [historyImages, setHistoryImages] = useState<GeneratedImage[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [generatedSlots, setGeneratedSlots] = useState<ImageGridSlot[]>([]);

  // 从 Portfolio 恢复历史生成记录
  useEffect(() => {
    if (!activeProviderId) return;
    let cancelled = false;
    void getRecentImagesByScope(scope).then(images => {
      if (cancelled) return;
      setHistoryImages(images);
    });
    return () => { cancelled = true; };
  }, [activeProviderId]);

  // Batch Hook
  const {
    batchTasks,
    isBatchMode,
    batchConfig,
    selectedBatchImageIds,
    isGenerating: isBatchGenerating,
    setBatchConfig,
    setBatchTasks,
    setSelectedBatchImageIds,
    setIsBatchMode,
    startBatch,
    stopBatch,
    clearBatch,
    downloadAll,
    downloadSelected,
    safePreviewCountPerPrompt
  } = useBatchGenerator({
    showToast,
    saveImage,
    scope,
    activeProviderId
  });

  // 迭代助手：生成回调（需要在 params、useBatchGenerator 之后声明）
  const handleIterationGenerate = useCallback(async (optimizedPrompt: string, context: IterationContext) => {
    if (generateLockRef.current || isGenerating) return;

    const model = customModel.trim();
    if (!model) { showToast('请先填写模型名', 'error'); return; }
    if (!settings.baseUrl?.trim()) { showToast('请先填写 Base URL', 'error'); return; }
    if (!settings.apiKey?.trim()) { showToast('请先填写 API Key', 'error'); return; }

    setPrompt(optimizedPrompt);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const runId = ++generationRunIdRef.current;
    generateLockRef.current = true;
    setIsGenerating(true);

    try {
      const currentParams: GenerationParams = {
        ...(context.targetImage?.params || params),
        prompt: optimizedPrompt,
        referenceImages: refImages,
        model: model as ModelType,
        count: 1,
      };

      const outcomes = await generateImages(currentParams, settings, { signal: controller.signal });

      if (!isMountedRef.current || generationRunIdRef.current !== runId) return;

      const successImages = outcomes
        .filter(o => o.ok === true)
        .map(o => ({ ...(o as { ok: true; image: GeneratedImage }).image, sourceScope: scope, sourceProviderId: activeProviderId }));

      if (successImages.length === 0) {
        showToast('迭代生成失败', 'error');
        return;
      }

      if (isBatchMode) {
        const targetId = context.targetImage.id;
        setBatchTasks(prev => {
          const matched = prev.some(t => t.images?.some(img => img.id === targetId));
          if (matched) {
            return prev.map(t =>
              t.images?.some(img => img.id === targetId)
                ? { ...t, images: [...(t.images || []), ...successImages] }
                : t
            );
          }
          setCurrentImages(p => [...successImages, ...p]);
          return prev;
        });
      } else {
        setCurrentImages(prev => [...successImages, ...prev]);
      }

      for (const img of successImages) {
        await saveImage(img);
      }

      showToast(`迭代生成完成（${successImages.length} 张新图）`, 'success');
    } catch (error) {
      if (!isMountedRef.current || generationRunIdRef.current !== runId) return;
      const aborted = (error as { name?: string })?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) { showToast('已停止生成', 'info'); return; }
      showToast('生成错误：' + (error instanceof Error ? error.message : '未知错误'), 'error');
    } finally {
      if (generationRunIdRef.current === runId) generateLockRef.current = false;
      if (!isMountedRef.current || generationRunIdRef.current !== runId) return;
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [params, refImages, customModel, settings, scope, activeProviderId, saveImage, showToast, isGenerating, isBatchMode, setBatchTasks]);

  const batchPromptCount = useMemo(() => {
      const prompts = parsePromptsToBatch(prompt);
      const safeCountPerPrompt = Math.max(1, Math.min(4, Math.floor(batchConfig.countPerPrompt || 1)));
      const maxBatchPromptCount = Math.max(1, Math.floor(MAX_BATCH_TOTAL / safeCountPerPrompt));
      return Math.min(prompts.length, maxBatchPromptCount);
  }, [prompt, batchConfig.countPerPrompt]);

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
        setCustomModel(draft.model || activeProvider.defaultModel || 'google/nano-banana');
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
        setCustomModel(activeProvider.defaultModel || 'google/nano-banana');
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
      // 检查供应商是否正在被删除，避免竞态条件导致被删除的供应商被重新插入
      if (deletingProviderIdRef.current === next.id) return;
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
    const base = createDefaultProvider();
    const now = Date.now();
    const created: ProviderProfile = {
      ...base,
      id: crypto.randomUUID(),
      name: '新供应商',
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

    // 标记正在删除，防止配置持久化的定时器重新插入被删除的供应商
    deletingProviderIdRef.current = activeProvider.id;
    try {
      await deleteProviderFromDb(activeProvider.id);
      const next = await getProvidersFromDb(scope);
      setProviders(next);
      const nextActive = next[0]?.id || '';
      if (nextActive) await handleSelectProvider(nextActive);
    } finally {
      deletingProviderIdRef.current = null;
    }
  };

  const handleToggleFavorite = () => setProviderFavorite((v) => !v);

  const handleOptimizePrompt = async () => {
    if (!prompt.trim()) return;
    if (!optimizerConfig?.enabled) return;

    setIsOptimizing(true);
    try {
      const newPrompt = await optimizeUserPrompt(prompt, optimizerConfig?.templateId);
      setPrompt(newPrompt);
      showToast('提示词已优化', 'success');
    } catch (err) {
      showToast('提示词优化失败：' + (err instanceof Error ? err.message : '未知错误'), 'error');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleBatchGenerate = async () => {
    const model = customModel.trim();
    if (!model) {
      showToast('请先填写模型名', 'error');
      return;
    }
    if (!settings.baseUrl?.trim()) {
      showToast('请先填写 Base URL', 'error');
      return;
    }
    if (!settings.apiKey?.trim()) {
      showToast('请先填写 API Key', 'error');
      return;
    }

    const baseParams: GenerationParams = {
        ...params,
        referenceImages: refImages,
        model: model as ModelType,
    };

    await startBatch(
        prompt,
        baseParams,
        (p, signal) => generateImages(p, settings, {
            signal,
            // Kie specific logic for ref images handling inside services/kie handles this,
            // but we pass params which has refImages.
            // If we wanted to optimize upload, generateImages in kie supports imageInputUrls option.
            // But useBatchGenerator doesn't support pre-upload optimization across batches generically yet.
            // That's acceptable for now as Kie service handles it per task.
        }),
        optimizerConfig
    );
  };

  const handleGenerate = async () => {
    if (isBatchGenerating) return;
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

    // Check if batch
    const batchPrompts = parsePromptsToBatch(prompt);
    if (batchPrompts.length > 1) {
        await handleBatchGenerate();
        return;
    }

    if (isBatchMode) {
        clearBatch();
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
        finalPrompt = await optimizeUserPrompt(prompt, optimizerConfig.templateId);
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
      setCurrentImages(prev => [...successImages, ...prev]);

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
    if (isGenerating) {
        try {
            abortControllerRef.current?.abort();
        } catch {
            // ignore
        }
    }
    if (isBatchGenerating) {
        stopBatch();
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
          setRefImages((prev) => [...prev, ...newImages].slice(0, MAX_REF_IMAGES));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeRefImage = (index: number) => {
    setRefImages((prev) => prev.filter((_, i) => i !== index));
  };

  const addRefImages = useCallback((dataUrls: string[]) => {
    setRefImages((prev) => [...prev, ...dataUrls].slice(0, MAX_REF_IMAGES));
  }, []);

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

  const isBusy = isGenerating || isBatchGenerating;

  return (
    <div className="aurora-page">
      {/* ========== 主行：侧边栏 + 画布 + 迭代助手 ========== */}
      <div className="aurora-main-row">
        {/* 左侧边栏：API 配置 */}
        <aside className="aurora-sidebar space-y-4">
          <div className="aurora-section-header">
            <Plug className="w-4 h-4 text-banana-500" />
            <span className="aurora-section-title">Kie AI 设置</span>
          </div>

          {/* 供应商选择 */}
          <div className="space-y-2">
            <label className="text-xs text-text-muted">供应商</label>
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
                className="flex-1 h-8 flex items-center justify-center gap-1 rounded-[var(--radius-md)] border border-ash bg-void text-text-muted hover:text-text-primary hover:border-smoke transition-colors text-xs"
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
                className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-md)] border border-ash bg-void text-text-muted hover:text-error hover:border-error/50 transition-colors"
                title="删除供应商"
                aria-label="删除供应商"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 供应商名称编辑 */}
          <div className="space-y-2">
            <label className="text-xs text-text-muted">供应商名称</label>
            <input
              type="text"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="自定义名称..."
              className={inputBaseStyles}
            />
          </div>

          {/* API Key */}
          <form className="space-y-2" onSubmit={(e) => e.preventDefault()} autoComplete="off">
            <label className="text-xs text-text-muted">API Key</label>
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="API Key"
              className={inputBaseStyles}
              autoComplete="off"
            />
            {!settings.apiKey.trim() && (
              <p className="text-xs text-warning/80">未填写 API Key，生成/增强将不可用。</p>
            )}
          </form>

          {/* Base URL */}
          <div className="space-y-2">
            <label className="text-xs text-text-muted">Base URL</label>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={(e) => setSettings((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://api.kie.ai"
              className={inputBaseStyles}
            />
            {!settings.baseUrl.trim() && (
              <p className="text-xs text-warning/80">未填写 Base URL，生成/增强将不可用。</p>
            )}
          </div>
        </aside>

        {/* 中间画布：图片展示 */}
        <div className="aurora-canvas">
          <div className="aurora-canvas-header">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-banana-500" />
              <span className="aurora-section-title">生成结果</span>
            </div>
            <div className="flex items-center gap-2">
              {currentImages.length > 0 && !isBusy && (
                <button
                  type="button"
                  onClick={() => setCurrentImages([])}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  清空本轮
                </button>
              )}
              <span className="aurora-badge aurora-badge-gold">Kie AI</span>
            </div>
          </div>
          <div className={`aurora-canvas-body ${isBatchMode ? 'aurora-canvas-body-batch' : ''}`}>
            {/* 批量模式进度条 */}
            {isBatchMode && batchTasks.length > 0 && (
              <div className="aurora-batch-progress">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-text-secondary whitespace-nowrap">
                      批量任务进度：{batchTasks.filter(t => t.status === 'success' || t.status === 'error').length}/{batchTasks.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-2 text-xs">
                      <span className="text-success">{batchTasks.filter(t => t.status === 'success').length} 成功</span>
                      <span className="text-error">{batchTasks.filter(t => t.status === 'error').length} 失败</span>
                      <span className="text-text-muted">{batchTasks.filter(t => t.status === 'pending' || t.status === 'running').length} 进行中</span>
                    </div>
                    {isBatchGenerating && (
                      <button
                        type="button"
                        onClick={stopBatch}
                        className="h-7 px-2 rounded-[var(--radius-md)] border border-error/40 bg-error/10 text-error hover:bg-error/20 transition-colors text-xs"
                      >
                        取消
                      </button>
                    )}
                    {!isBatchGenerating &&
                      batchTasks.every(t => t.status === 'success' || t.status === 'error') &&
                      batchTasks.some(t => (t.images?.length || 0) > 0) && (
                        <>
                          <button
                            type="button"
                            onClick={() => void downloadAll()}
                            className="h-7 px-2 rounded-[var(--radius-md)] border border-ash bg-void text-text-secondary hover:text-text-primary hover:border-smoke transition-colors text-xs"
                          >
                            下载全部
                          </button>
                          <button
                            type="button"
                            onClick={() => void downloadSelected()}
                            disabled={selectedBatchImageIds.length === 0}
                            className="h-7 px-2 rounded-[var(--radius-md)] border border-ash bg-void text-text-secondary hover:text-text-primary hover:border-smoke transition-colors text-xs disabled:opacity-40"
                          >
                            下载选中
                          </button>
                        </>
                      )}
                  </div>
                </div>
              </div>
            )}
            {isBatchMode ? (
              <>
                <BatchImageGrid
                  tasks={batchTasks}
                  countPerPrompt={safePreviewCountPerPrompt}
                  selectedImageIds={selectedBatchImageIds}
                  onToggleSelect={(id) => {
                    setSelectedBatchImageIds((prev) =>
                      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
                    );
                  }}
                  onImageClick={onImageClick}
                  onEdit={onEdit}
                  onIterate={handleIterate}
                />
                {/* 批量模式下，迭代生成的新图单独展示 */}
                {currentImages.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-text-muted mb-2 px-1">迭代生成 ({currentImages.length})</div>
                    <ImageGrid
                      images={currentImages}
                      slots={generatedSlots}
                      isGenerating={isGenerating}
                      params={params}
                      onImageClick={onImageClick}
                      onEdit={onEdit}
                      onIterate={handleIterate}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <ImageGrid
                  images={currentImages}
                  slots={generatedSlots}
                  isGenerating={isGenerating}
                  params={params}
                  onImageClick={onImageClick}
                  onEdit={onEdit}
                  onIterate={handleIterate}
                />
                {historyImages.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setHistoryExpanded(v => !v)}
                      className="w-full flex items-center gap-2 py-2 px-1 text-xs text-text-muted hover:text-text-primary transition-colors border-t border-dark-border mt-3"
                    >
                      {historyExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      <History className="w-3.5 h-3.5" />
                      <span>历史记录 ({historyImages.length}张)</span>
                    </button>
                    {historyExpanded && (
                      <ImageGrid
                        images={historyImages}
                        isGenerating={false}
                        params={params}
                        onImageClick={onImageClick}
                        onEdit={onEdit}
                        onIterate={handleIterate}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* 右侧迭代助手（≥1200px 才显示） */}
        <aside className="aurora-assistant">
          <IterationAssistant
            currentPrompt={prompt}
            onUseVersion={setPrompt}
            iterateTemplateId={optimizerConfig?.iterateTemplateId}
            onTemplateChange={handleIterateTemplateChange}
            iterationMode={iterationMode}
            iterationContext={iterationContext}
            onClearContext={handleClearIterationContext}
            onGenerate={handleIterationGenerate}
            onSwitchTarget={handleSwitchTarget}
          />
        </aside>
      </div>

      {/* ========== 底部提示词区：优化器 + 输入 + 配置 ========== */}
      <div className="aurora-prompt-area">
        {/* 左列：提示词优化器 */}
        <div className="aurora-prompt-optimizer">
          <div className="aurora-section-header">
            <Wand2 className="w-4 h-4 text-banana-500" />
            <span className="aurora-section-title">提示词优化器</span>
          </div>
          <PromptOptimizerSettings
            onConfigChange={handleOptimizerConfigChange}
            currentPrompt={prompt}
            onOptimize={handleOptimizePrompt}
            isOptimizing={isOptimizing}
          />
        </div>

        {/* 中列：提示词输入 */}
        <div className="aurora-prompt-input">
          <RefImageRow
            images={refImages}
            maxImages={MAX_REF_IMAGES}
            onFileUpload={handleFileUpload}
            onRemove={removeRefImage}
            onAddImages={addRefImages}
          />

          <div className="aurora-textarea-wrapper flex-1">
            <div className="aurora-prompt-box">
              <Sparkles className="aurora-prompt-box-icon" />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="描述你想要的画面..."
                className="aurora-prompt-box-textarea"
              />
            </div>
            {!prompt.trim() && <SamplePromptChips onPick={setPrompt} />}
          </div>

          {/* 小屏参考图按钮 */}
          <div className="lg:hidden relative">
            <button
              onClick={() => setShowRefPopover(!showRefPopover)}
              className={getRefImageButtonStyles(refImages.length > 0)}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span className="text-xs">参考图 {refImages.length}/{MAX_REF_IMAGES}</span>
            </button>
            {showRefPopover && (
              <div className="absolute bottom-full left-0 mb-2 w-64 bg-graphite border border-ash rounded-[var(--radius-md)] p-3 shadow-[var(--shadow-floating)] z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted">参考图 ({refImages.length}/{MAX_REF_IMAGES})</span>
                  <button
                    type="button"
                    aria-label="关闭参考图"
                    onClick={() => setShowRefPopover(false)}
                    className="text-text-muted hover:text-text-primary"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {refImages.length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5 mb-2">
                    {refImages.map((img, idx) => (
                      <div key={idx} className="relative aspect-square rounded-[var(--radius-md)] overflow-hidden border border-ash group">
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
                <div className="flex gap-1.5">
                  <label className="flex-1 flex items-center justify-center h-8 text-xs text-text-muted hover:text-text-primary border border-dashed border-ash hover:border-banana-500/50 rounded-[var(--radius-md)] cursor-pointer transition-colors">
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    添加参考图
                    <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                  </label>
                  <div
                    className="relative flex-1"
                    onMouseEnter={() => {
                      if (portfolioTimerRef.current) {
                        clearTimeout(portfolioTimerRef.current);
                        portfolioTimerRef.current = undefined;
                      }
                      setShowMobilePortfolio(true);
                    }}
                    onMouseLeave={() => {
                      portfolioTimerRef.current = setTimeout(() => {
                        setShowMobilePortfolio(false);
                      }, 250);
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowMobilePortfolio((v) => !v)}
                      className="w-full flex items-center justify-center h-8 text-xs text-text-muted hover:text-text-primary border border-dashed border-ash hover:border-banana-500/50 rounded-[var(--radius-md)] cursor-pointer transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5 mr-1" />
                      作品集
                    </button>
                    {showMobilePortfolio && (
                      <PortfolioPicker
                        selectedImages={refImages}
                        onPick={(base64) => {
                          const idx = refImages.indexOf(base64);
                          if (idx >= 0) {
                            removeRefImage(idx);
                          } else {
                            addRefImages([base64]);
                          }
                        }}
                        onClose={() => setShowMobilePortfolio(false)}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右列：参数配置（outputFormat 保留在此） */}
        <div className="aurora-prompt-config">
          {/* 模型 */}
          <div>
            <label className="text-xs text-text-muted mb-1 block">模型</label>
            <div className="relative">
              <select
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                className={selectBaseStyles}
              >
                {KIE_PRESET_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            </div>
          </div>

          {/* 比例 + 尺寸 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-muted mb-1 block">比例</label>
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
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">尺寸</label>
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
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
              </div>
            </div>
          </div>

          {/* 输出格式 */}
          <div>
            <label className="text-xs text-text-muted mb-1 block">格式</label>
            <div className="relative">
              <select
                value={params.outputFormat || 'png'}
                onChange={(e) => setParams((prev) => ({ ...prev, outputFormat: e.target.value as NonNullable<GenerationParams['outputFormat']> }))}
                className={selectSmallStyles}
              >
                <option value="png">png</option>
                <option value="jpg">jpg</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
            </div>
          </div>

          {/* 批量任务配置 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-muted mb-1 block">并发数</label>
              <div className="relative">
                <select
                  value={batchConfig.concurrency}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 1) return;
                    setBatchConfig((prev) => ({ ...prev, concurrency: v }));
                  }}
                  className={selectSmallStyles}
                  disabled={isBusy}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">每提示词</label>
              <div className="relative">
                <select
                  value={batchConfig.countPerPrompt}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 1) return;
                    setBatchConfig((prev) => ({ ...prev, countPerPrompt: v }));
                  }}
                  className={selectSmallStyles}
                  disabled={isBusy}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
              </div>
            </div>
          </div>

          {/* 生成按钮 */}
          <div className="mt-auto space-y-1">
            {batchPromptCount > 0 && (
              <span className="text-xs text-banana-500 text-center block">
                提示词:{batchPromptCount}，每提示词:{safePreviewCountPerPrompt} 图片数{batchPromptCount * safePreviewCountPerPrompt}
              </span>
            )}
            <button
              onClick={isBusy ? handleStop : handleGenerate}
              disabled={!isBusy && !canGenerate}
              className={`aurora-generate-btn ${isBusy ? 'stopping' : ''}`}
            >
              {isBusy ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>停止</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  <span>生成</span>
                </>
              )}
            </button>
            {isBatchMode && batchTasks.length > 0 && !isBusy && (
              <button
                onClick={clearBatch}
                className="w-full h-6 text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                清除队列
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
