import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Plus, ChevronDown, ChevronRight, X, Plug, Star, Trash2, Sparkles, Image as ImageIcon, Wand2, FolderOpen, History, Settings, ImagePlus } from 'lucide-react';
import {
  OpenAISettings,
  GeneratedImage,
  GenerationParams,
  ModelType,
  ProviderProfile,
  ProviderScope,
  PromptOptimizerConfig,
  IterationContext,
  IterationMode,
} from '../types';
import { generateImages } from '../services/openai';
import { optimizeUserPrompt } from '../services/mcp';
import { useToast } from './Toast';
import { ImageGrid, ImageGridSlot } from './ImageGrid';
import { BatchImageGrid } from './BatchImageGrid';
import { PromptOptimizerSettings } from './PromptOptimizerSettings';
import { IterationAssistant } from './IterationAssistant';
import { SamplePromptChips } from './SamplePromptChips';
import { PortfolioPicker } from './PortfolioPicker';
import {
  getFavoriteButtonStyles,
  inputBaseStyles,
  selectBaseStyles,
  selectSmallStyles,
} from './uiStyles';
import {
  getPromptOptimizerConfig,
  setPromptOptimizerConfig,
  getRecentImagesByScope,
} from '../services/db';
import { useProviderManagement } from '../hooks/useProviderManagement';
import { useBatchGenerator } from '../hooks/useBatchGenerator';
import { parsePromptsToBatch, MAX_BATCH_TOTAL } from '../services/batch';

interface OpenAIPageProps {
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

/**
 * Antigravity 专用：仅保留基础图片模型，过滤掉分辨率/比例后缀变体。
 * 官方推荐方式 1（基础模型 + size/quality 参数），后缀变体通过 UI 选择器控制。
 * 过滤: gemini-3-pro-image-2k, -4k, -16x9, -2k-16x9, -4k-3x4 等
 * 保留: gemini-3-pro-image
 */
const isBaseGeminiImageModel = (id: string): boolean => {
  if (!isGeminiImageModelId(id)) return false;
  return !/image[-_](?:\d+k|\d+[x-]\d+)/i.test(id);
};

/** 判断是否为文本生成模型（用于提示词优化） */
const isTextModelId = (id: string): boolean => {
  const s = id.toLowerCase();
  // 排除非文本生成模型（避免把 embedding / moderation / 音频等误判为可用于 chat.completions 的模型）
  const excludeKeywords = [
    'image',
    'vision',
    'dall-e',
    'stable-diffusion',
    'embedding',
    'moderation',
    'whisper',
    'tts',
    'audio',
    'speech',
  ];
  if (excludeKeywords.some((k) => s.includes(k))) return false;
  // 常见文本模型关键词
  const textKeywords = [
    'gpt', 'claude', 'gemini', 'llama', 'mistral', 'qwen', 'deepseek',
    'chat', 'turbo', 'instruct', 'text', 'completion'
  ];
  return textKeywords.some(keyword => s.includes(keyword));
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

const MAX_REF_IMAGES = 8;

export const OpenAIPage = ({ saveImage, onImageClick, onEdit, variant = 'third_party' }: OpenAIPageProps) => {
  const { showToast } = useToast();
  const scope: ProviderScope = variant === 'antigravity_tools' ? 'antigravity_tools' : 'openai_proxy';
  const isAntigravityTools = variant === 'antigravity_tools';
  const requiresApiKey = !isAntigravityTools;

  // Generator State
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState(() => (
    variant === 'antigravity_tools' ? 'gemini-3-pro-image' : 'gemini-3-pro-image'
  ));
  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    count: 1,
    model: ModelType.CUSTOM, // OpenAI 模式使用自定义模型
  });

  const {
    providers,
    activeProviderId,
    activeProvider,
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
    providerName,
    setProviderName,
    providerFavorite,
    handleSelectProvider,
    handleCreateProvider,
    handleDeleteProvider,
    toggleFavorite,
    updateActiveProvider,
  } = useProviderManagement({
    scope,
    createDefaultProvider,
    onDraftLoaded: useCallback((draft, defaultModel) => {
      if (draft) {
        setPrompt(draft.prompt || '');
        setParams(draft.params);
        setRefImages(draft.refImages || []);
        setCustomModel(draft.model || defaultModel || 'gemini-3-pro-image');
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
        setCustomModel(defaultModel || 'gemini-3-pro-image');
      }
    }, []),
    draftState: {
      prompt,
      params,
      refImages,
      model: customModel,
    },
  });

  // Settings object for API calls
  const settings: OpenAISettings = useMemo(() => ({
    apiKey,
    baseUrl,
  }), [apiKey, baseUrl]);

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

  // Antigravity 模型后缀自动同步：选择带后缀的模型时同步比例/尺寸选择器
  // e.g. gemini-3-pro-image-2k-16x9 → aspectRatio='16:9', imageSize='2K'
  useEffect(() => {
    if (!isAntigravityTools) return;
    const s = customModel.toLowerCase();

    const sizeMatch = s.match(/(?:^|[-_])(2k|4k)(?:$|[-_])/);
    let detectedSize: GenerationParams['imageSize'] | null = null;
    if (sizeMatch?.[1] === '2k') detectedSize = '2K';
    if (sizeMatch?.[1] === '4k') detectedSize = '4K';

    const ratioMatch = s.match(/(?:^|[-_])(1|3|4|9|16|21)[x-](1|3|4|9|16)(?:$|[-_])/);
    let detectedRatio: GenerationParams['aspectRatio'] | null = null;
    if (ratioMatch) {
      const key = `${ratioMatch[1]}:${ratioMatch[2]}`;
      const allowed = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']);
      if (allowed.has(key)) detectedRatio = key as GenerationParams['aspectRatio'];
    }

    if (detectedRatio || detectedSize) {
      setParams(prev => ({
        ...prev,
        ...(detectedRatio && { aspectRatio: detectedRatio }),
        ...(detectedSize && { imageSize: detectedSize }),
      }));
    }
  }, [customModel, isAntigravityTools]);

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
  const [isDragOverRef, setIsDragOverRef] = useState(false);
  const [showPortfolioPicker, setShowPortfolioPicker] = useState(false);
  const [isRefPanelOpen, setIsRefPanelOpen] = useState(false);
  const refPanelRef = useRef<HTMLDivElement>(null);
  const portfolioTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // 点击外部关闭参考图面板（触摸设备）
  useEffect(() => {
    if (!isRefPanelOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (refPanelRef.current && !refPanelRef.current.contains(e.target as Node)) {
        setIsRefPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isRefPanelOpen]);

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

  // Antigravity Tools model list (optional UX)
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableImageModels, setAvailableImageModels] = useState<string[]>([]);
  const [availableTextModels, setAvailableTextModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsHint, setModelsHint] = useState<string>('');

  // Results
  // Results: 本轮生成 + 历史记录（折叠）
  const [currentImages, setCurrentImages] = useState<GeneratedImage[]>([]);
  const [historyImages, setHistoryImages] = useState<GeneratedImage[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [apiConfigExpanded, setApiConfigExpanded] = useState(false);
  const [generatedSlots, setGeneratedSlots] = useState<ImageGridSlot[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);

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

  // 历史记录展开时自动滚动
  useEffect(() => {
    if (historyExpanded && historyRef.current) {
      requestAnimationFrame(() => {
        historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [historyExpanded]);

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

  const handleIterationGenerate = useCallback(async (optimizedPrompt: string, context: IterationContext) => {
    if (generateLockRef.current || isGenerating) return;

    const model = customModel.trim();
    if (!model) { showToast('请先填写模型名', 'error'); return; }
    if (!baseUrl?.trim()) { showToast('请先填写 Base URL', 'error'); return; }
    if (requiresApiKey && !apiKey?.trim()) { showToast('请先填写 API Key', 'error'); return; }

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

      const outcomes = await generateImages(currentParams, settings, {
        signal: controller.signal,
      });

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
  }, [params, refImages, customModel, apiKey, baseUrl, settings, scope, activeProviderId, requiresApiKey, saveImage, showToast, isGenerating, isBatchMode, setBatchTasks]);

  const batchPromptCount = useMemo(() => {
      const prompts = parsePromptsToBatch(prompt);
      const safeCountPerPrompt = Math.max(1, Math.min(4, Math.floor(batchConfig.countPerPrompt || 1)));
      const maxBatchPromptCount = Math.max(1, Math.floor(MAX_BATCH_TOTAL / safeCountPerPrompt));
      return Math.min(prompts.length, maxBatchPromptCount);
  }, [prompt, batchConfig.countPerPrompt]);

  // Restore available models from activeProvider cache when it changes
  useEffect(() => {
    if (!activeProvider) return;

    const cache = activeProvider.modelsCache;
    if (cache?.all?.length) {
      setAvailableModels(cache.all);
      const imageFilter = isAntigravityTools ? isBaseGeminiImageModel : isGeminiImageModelId;
      const imageList = (cache.image?.length ? cache.image : cache.all).filter(imageFilter);
      setAvailableImageModels(imageList);
      const textList = (cache.text?.length ? cache.text : cache.all).filter(isTextModelId);
      setAvailableTextModels(textList);
      const dt = new Date(cache.fetchedAt).toLocaleString();
      setModelsHint(`已缓存模型列表（${cache.all.length}） • ${dt}`);
    } else if (cache?.lastError) {
      setAvailableModels([]);
      setAvailableImageModels([]);
      setAvailableTextModels([]);
      setModelsHint(cache.lastError);
    } else {
      setAvailableModels([]);
      setAvailableImageModels([]);
      setAvailableTextModels([]);
      setModelsHint('');
    }
  }, [activeProvider?.id, activeProvider?.modelsCache]);

  const handleRefreshModels = async () => {
    if (!activeProvider) {
      return;
    }
    if (!baseUrl) {
      showToast('请先填写 Base URL', 'error');
      return;
    }

    setIsLoadingModels(true);
    setModelsHint('');
    try {
      const cleanBaseUrl = baseUrl.replace(/\/$/, '');
      const url = `${cleanBaseUrl}/v1/models`;

      const fetchModels = async (withAuth: boolean): Promise<Response> => {
        const headers: Record<string, string> = {};
        if (withAuth) {
          const key = apiKey || (variant === 'antigravity_tools' ? 'sk-antigravity' : '');
          if (key) headers.Authorization = `Bearer ${key}`;
        }
        return fetch(url, { method: 'GET', headers });
      };

      // 认证策略
      const hasApiKey = !!apiKey || variant === 'antigravity_tools';
      let resp = await fetchModels(hasApiKey);

      if (!hasApiKey && (resp.status === 401 || resp.status === 403) && apiKey) {
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

      const imageFilter = isAntigravityTools ? isBaseGeminiImageModel : isGeminiImageModelId;
      const geminiImageIds = uniqueIds.filter(imageFilter);
      const effectiveImageModels = geminiImageIds.length > 0 ? geminiImageIds : uniqueIds;
      setAvailableImageModels(effectiveImageModels);

      const textIds = uniqueIds.filter(isTextModelId);
      setAvailableTextModels(textIds);

      const modelsCache = {
        all: uniqueIds,
        image: geminiImageIds,
        text: textIds,
        fetchedAt: Date.now(),
        lastError: undefined,
      };

      await updateActiveProvider({ modelsCache });

      const hints: string[] = [];
      if (effectiveImageModels.length > 0) {
        const label = geminiImageIds.length > 0 ? 'Gemini 图像模型' : '可用模型';
        hints.push(`${effectiveImageModels.length} 个${label}`);
      }
      if (textIds.length > 0) {
        hints.push(`${textIds.length} 个文本模型`);
      }
      if (hints.length > 0) {
        setModelsHint(`已刷新模型列表（${uniqueIds.length}），筛选到 ${hints.join('、')}。`);
      } else {
        setModelsHint(`已刷新模型列表（${uniqueIds.length}），但未找到图像/文本模型；请手动输入模型名。`);
      }

      showToast('Models refreshed', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown';
      const hint = `无法从 /v1/models 拉取模型列表（可能是不支持该接口、被 CORS 拦截或需要鉴权）：${msg}`;
      setModelsHint(hint);

      await updateActiveProvider({
        modelsCache: {
          all: activeProvider.modelsCache?.all || [],
          image: activeProvider.modelsCache?.image || [],
          text: activeProvider.modelsCache?.text || [],
          fetchedAt: activeProvider.modelsCache?.fetchedAt || Date.now(),
          lastError: hint,
        }
      });

      showToast('Failed to refresh models: ' + msg, 'error');
    } finally {
      setIsLoadingModels(false);
    }
  };

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
      const model = customModel;
      if (!model.trim()) {
        showToast('请先填写模型名', 'error');
        return;
      }
      if (!baseUrl?.trim()) {
        showToast('请先填写 Base URL', 'error');
        return;
      }
      if (requiresApiKey && !apiKey?.trim()) {
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
          (p, signal) => generateImages(p, settings, { signal }),
          optimizerConfig
      );
  };

  const handleGenerate = async () => {
    if (isBatchGenerating) return;
    if (generateLockRef.current) return;
    if (isGenerating) return;
    if (!prompt.trim()) return;

    if (isBatchMode) {
        clearBatch();
    }

    const model = customModel;
    if (!model.trim()) {
      showToast('请先填写模型名', 'error');
      return;
    }
    if (!apiKey && requiresApiKey) {
      showToast('请先填写 API Key', 'error');
      return;
    }
    if (!baseUrl) {
      showToast('请先填写 Base URL', 'error');
      return;
    }

    // Check if batch
    const batchPrompts = parsePromptsToBatch(prompt);
    if (batchPrompts.length > 1) {
        await handleBatchGenerate();
        return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const runId = ++generationRunIdRef.current;

    generateLockRef.current = true;
    setIsGenerating(true);

    let finalPrompt = prompt;
    if (optimizerConfig?.enabled && optimizerConfig.mode === 'auto') {
      try {
        finalPrompt = await optimizeUserPrompt(prompt, optimizerConfig.templateId);
        setPrompt(finalPrompt);
        showToast('提示词已自动优化', 'info');
      } catch (err) {
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
      // 使用 UI 可见的 "每词" 数量，而非 params.count（可能来自旧草稿残留值）
      const currentParams: GenerationParams = {
        ...params,
        prompt: finalPrompt,
        referenceImages: refImages,
        model: model as ModelType,
        count: safePreviewCountPerPrompt,
      };

      const slotIds = Array.from({ length: currentParams.count }, () => crypto.randomUUID());
      setGeneratedSlots(slotIds.map((id) => ({ id, status: 'pending' })));

      const outcomes = await generateImages(currentParams, settings, {
        signal: controller.signal,
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
        showToast(`生成完成：成功 ${successCount} 张，失败 ${failCount} 张`, 'info');
      } else {
        showToast('生成完成', 'success');
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      if (generationRunIdRef.current !== runId) return;

      const aborted = (error as any)?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        setGeneratedSlots((prev) =>
          prev.map((s) => (s.status === 'pending' ? { id: s.id, status: 'error', error: '已停止' } : s))
        );
        showToast('已停止生成', 'info');
        return;
      }

      showToast('生成错误：' + (error instanceof Error ? error.message : '未知错误'), 'error');
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList) as File[];

    try {
      const newImages = await Promise.all(
        files.map(file =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              if (typeof reader.result === 'string') {
                resolve(reader.result);
              } else {
                reject(new Error('Failed to read file'));
              }
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
        )
      );
      setRefImages((prev) => [...prev, ...newImages].slice(0, MAX_REF_IMAGES));
    } catch (err) {
      showToast('图片上传失败', 'error');
    }

    // 清空 input value，允许重复上传相同文件
    e.target.value = '';
  };

  const removeRefImage = (index: number) => {
    setRefImages((prev) => prev.filter((_, i) => i !== index));
  };

  const addRefImages = useCallback((dataUrls: string[]) => {
    setRefImages((prev) => [...prev, ...dataUrls].slice(0, MAX_REF_IMAGES));
  }, []);

  const canGenerate =
    !!prompt.trim() &&
    !!customModel.trim() &&
    !!baseUrl?.trim() &&
    (!requiresApiKey || !!apiKey?.trim());

  const isBusy = isGenerating || isBatchGenerating;

  return (
    <div className="aurora-page">
      {/* ========== 主行：侧边栏 + 画布 + 迭代助手 ========== */}
      <div className="aurora-main-row">
        {/* 左侧边栏：API 配置 */}
        <aside className="aurora-sidebar space-y-4">
          {/* 可折叠 API 配置 */}
          <button
            type="button"
            onClick={() => setApiConfigExpanded(v => !v)}
            className="w-full flex items-center gap-2 text-left"
          >
            <Settings className="w-4 h-4 text-banana-500" />
            <span className="aurora-section-title flex-1">
              {variant === 'antigravity_tools' ? 'Antigravity Tools' : 'OpenAI Compatible'}
            </span>
            {requiresApiKey && !apiKey?.trim() && (
              <span className="w-2 h-2 rounded-full bg-warning animate-pulse" title="未配置 API Key" />
            )}
            {apiConfigExpanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
          </button>

          {apiConfigExpanded && (
            <div className="space-y-3 pt-1">
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
                      {(p.favorite ? '★ ' : '') + (p.name || p.id)}
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
                    onClick={toggleFavorite}
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
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className={inputBaseStyles}
                  autoComplete="off"
                />
                {requiresApiKey && !apiKey?.trim() && (
                  <p className="text-xs text-warning/80">未填写 API Key，无法生成。</p>
                )}
              </form>

              {/* Base URL */}
              <div className="space-y-2">
                <label className="text-xs text-text-muted flex items-center gap-1">
                  Base URL
                  <span className="text-[10px] text-text-disabled">(可选)</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => {
                      const next = e.target.value;
                      setBaseUrl(next);
                      setAvailableModels([]);
                      setAvailableImageModels([]);
                      setModelsHint('');
                    }}
                    placeholder={variant === 'antigravity_tools' ? '/antigravity' : 'https://api.openai.com'}
                    className={`flex-1 ${inputBaseStyles}`}
                  />
                  <button
                    onClick={() => void handleRefreshModels()}
                    disabled={isLoadingModels || !baseUrl}
                    className="h-9 px-2.5 text-xs rounded-[var(--radius-md)] border border-ash bg-void text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
                    title={modelsHint || '刷新模型列表'}
                  >
                    {isLoadingModels ? '...' : '刷新'}
                  </button>
                </div>
                {!baseUrl?.trim() && (
                  <p className="text-xs text-warning/80">未填写 Base URL，无法请求模型列表与生成。</p>
                )}
              </div>
            </div>
          )}

          {/* 分隔线 */}
          <div className="border-t border-ash" />

          {/* 提示词优化器 */}
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
        </aside>

        {/* 中间画布：图片展示 */}
        <div className="aurora-canvas">
          <div className="aurora-canvas-header">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-banana-500" />
              <span className="aurora-section-title">生成结果</span>
            </div>
            <div className="flex items-center gap-2">
              {historyImages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHistoryExpanded(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  {historyExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <History className="w-3.5 h-3.5" />
                  <span>历史记录 ({historyImages.length}张)</span>
                </button>
              )}
              {currentImages.length > 0 && !isBusy && (
                <button
                  type="button"
                  onClick={() => { setCurrentImages([]); setGeneratedSlots([]); }}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  清空本轮
                </button>
              )}
              <span className="aurora-badge aurora-badge-gold">{variant === 'antigravity_tools' ? 'Antigravity' : 'OpenAI'}</span>
            </div>
          </div>
          <div className={`aurora-canvas-body ${isBatchMode ? 'aurora-canvas-body-batch' : ''}`} style={{ paddingBottom: '240px' }}>
            {historyExpanded && historyImages.length > 0 ? (
              <div ref={historyRef}>
                <ImageGrid
                  images={historyImages}
                  isGenerating={false}
                  params={params}
                  maxColumns={8}
                  gap={8}
                  onImageClick={onImageClick}
                  onEdit={onEdit}
                  onIterate={handleIterate}
                />
              </div>
            ) : (
              <>
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
                  (currentImages.length > 0 || isGenerating || generatedSlots.length > 0 || historyImages.length === 0) && (
                    <ImageGrid
                      images={currentImages}
                      slots={generatedSlots}
                      isGenerating={isGenerating}
                      params={params}
                      onImageClick={onImageClick}
                      onEdit={onEdit}
                      onIterate={handleIterate}
                    />
                  )
                )}
              </>
            )}
          </div>

          {/* 悬浮提示词组件 */}
          <div className="aurora-floating-prompt">
            {/* 提示词输入（参考图融合） */}
            <div className="aurora-prompt-box">
              {/* 参考图触发区 */}
              <div
                ref={refPanelRef}
                className={`aurora-ref-trigger ${isDragOverRef ? 'drag-over' : ''}`}
                onClick={(e) => {
                  // Toggle panel on click/tap (for touch devices)
                  // Only toggle if clicking on the trigger itself, not the panel
                  const target = e.target as HTMLElement;
                  if (target.closest('.aurora-ref-panel')) {
                    // Click inside panel - don't toggle
                    return;
                  }
                  setIsRefPanelOpen((prev) => !prev);
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('application/x-nano-ref-image')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setIsDragOverRef(true);
                  }
                }}
                onDragLeave={() => setIsDragOverRef(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOverRef(false);
                  const data = e.dataTransfer.getData('application/x-nano-ref-image');
                  if (data) addRefImages([data]);
                }}
              >
                {/* 堆叠态 / 空态 */}
                {refImages.length === 0 ? (
                  <div className="aurora-ref-empty">
                    <ImagePlus className="w-4 h-4" />
                    <span>参考图</span>
                  </div>
                ) : (
                  <div className="aurora-ref-stack">
                    {refImages.slice(0, 3).map((img, i) => (
                      <div key={i} className="aurora-ref-stack-card">
                        <img src={img} alt="" />
                      </div>
                    ))}
                    <span className="aurora-ref-stack-badge">{refImages.length}</span>
                  </div>
                )}

                {/* 悬浮展开面板 */}
                <div 
                  className={`aurora-ref-panel ${isRefPanelOpen ? 'force-open' : ''}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="aurora-ref-panel-header">
                    <span className="text-xs text-text-muted">参考图 ({refImages.length}/{MAX_REF_IMAGES})</span>
                  </div>
                  {refImages.length > 0 && (
                    <div className="aurora-ref-panel-grid">
                      {refImages.map((img, idx) => (
                        <div key={idx} className="aurora-ref-panel-thumb">
                          <img src={img} alt={`Ref ${idx + 1}`} />
                          <button
                            type="button"
                            onClick={() => removeRefImage(idx)}
                            aria-label="移除参考图"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="aurora-ref-panel-actions">
                    <label>
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>本地上传</span>
                      <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                    </label>
                    <div
                      className="relative"
                      onMouseEnter={() => {
                        if (portfolioTimerRef.current) {
                          clearTimeout(portfolioTimerRef.current);
                          portfolioTimerRef.current = undefined;
                        }
                        setShowPortfolioPicker(true);
                      }}
                      onMouseLeave={() => {
                        portfolioTimerRef.current = setTimeout(() => {
                          setShowPortfolioPicker(false);
                        }, 250);
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setShowPortfolioPicker((v) => !v)}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>作品集</span>
                      </button>
                      {showPortfolioPicker && (
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
                          onClose={() => setShowPortfolioPicker(false)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 分隔线 */}
              {refImages.length > 0 && <div className="aurora-ref-divider" />}

              {/* 文本输入 */}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="描述你想要的画面..."
                className="aurora-prompt-box-textarea"
              />
            </div>
            {requiresApiKey && !apiKey?.trim() && (
              <p className="mt-2 text-xs text-warning/80">
                未填写 API Key，无法生成。
              </p>
            )}
            {!prompt.trim() && <SamplePromptChips onPick={setPrompt} />}

            {/* 配置栏 + 生成按钮 */}
            <div className="aurora-config-bar">
              <div className="aurora-config-item">
                <label>模型</label>
                {availableImageModels.length > 0 ? (
                  <select
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                  >
                    {!availableImageModels.includes(customModel) && customModel && (
                      <option value={customModel}>{customModel} (自定义)</option>
                    )}
                    {availableImageModels.map((id) => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="输入模型名..."
                    className="text-xs"
                  />
                )}
              </div>
              <div className="aurora-config-item">
                <label>比例</label>
                <select
                  value={params.aspectRatio}
                  onChange={(e) => setParams({ ...params, aspectRatio: e.target.value as GenerationParams['aspectRatio'] })}
                >
                  {['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="aurora-config-item">
                <label>尺寸</label>
                <select
                  value={params.imageSize}
                  onChange={(e) => setParams({ ...params, imageSize: e.target.value as GenerationParams['imageSize'] })}
                >
                  {['1K', '2K', '4K'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="aurora-config-item">
                <label>并发</label>
                <select
                  value={batchConfig.concurrency}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 1) return;
                    setBatchConfig((prev) => ({ ...prev, concurrency: v }));
                  }}
                  disabled={isBusy}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="aurora-config-item">
                <label>每词</label>
                <select
                  value={batchConfig.countPerPrompt}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 1) return;
                    setBatchConfig((prev) => ({ ...prev, countPerPrompt: v }));
                  }}
                  disabled={isBusy}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              {batchPromptCount > 0 && (
                <span className="text-xs text-banana-500 whitespace-nowrap">
                  提示词:{batchPromptCount} · 每词:{safePreviewCountPerPrompt} · 共{batchPromptCount * safePreviewCountPerPrompt}张
                </span>
              )}
              <button
                onClick={isBusy ? handleStop : handleGenerate}
                disabled={!isBusy && !canGenerate}
                className={`aurora-generate-btn-inline ${isBusy ? 'stopping' : ''}`}
              >
                {isBusy ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>停止</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>生成</span>
                  </>
                )}
              </button>
              {isBatchMode && batchTasks.length > 0 && !isBusy && (
                <button
                  onClick={clearBatch}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  清除队列
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 右侧迭代助手 */}
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
    </div>
  );
};
