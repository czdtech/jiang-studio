import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Wand2, Plus, ChevronDown, X, Plug, Star, Trash2, Sparkles, Image as ImageIcon } from 'lucide-react';
import { OpenAISettings, GeneratedImage, GenerationParams, ModelType, ProviderProfile, ProviderScope, ProviderDraft, PromptOptimizerConfig } from '../types';
import { generateImages, optimizePrompt as optimizePromptOpenAI } from '../services/openai';
import { useToast } from './Toast';
import { ImageGrid, ImageGridSlot } from './ImageGrid';
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

const pickDefaultOptimizerModelId = (ids: string[]): string => {
  const list = ids.map((id) => id.trim()).filter(Boolean);
  if (list.length === 0) return '';

  const lowered = list.map((id) => ({ id, s: id.toLowerCase() }));
  const preferContains = ['gpt-4o-mini', 'claude-3-haiku', 'deepseek-chat', 'gpt-4o'];

  for (const key of preferContains) {
    const hit = lowered.find((m) => m.s.includes(key));
    if (hit) return hit.id;
  }

  // 没命中常见推荐时，优先挑更“轻量/便宜”的命名
  const cheapHint = lowered.find((m) => ['mini', 'haiku', 'flash'].some((k) => m.s.includes(k)));
  if (cheapHint) return cheapHint.id;

  return list[0];
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
  const requiresApiKey = !isAntigravityTools;

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
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [optimizerModel, setOptimizerModel] = useState<string>(''); // 自定义优化模型

  const [customModel, setCustomModel] = useState(() => (
    variant === 'antigravity_tools' ? 'gemini-3-pro-image' : 'gemini-3-pro-image'
  ));

  const [providerName, setProviderName] = useState<string>('');
  const [providerFavorite, setProviderFavorite] = useState<boolean>(false);

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

  // Antigravity Tools model list (optional UX)
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableImageModels, setAvailableImageModels] = useState<string[]>([]);
  const [availableTextModels, setAvailableTextModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsHint, setModelsHint] = useState<string>('');

  // 当未启用独立优化器配置时，尽量从已加载的文本模型中自动挑一个默认值，避免 Enhance 永远不可用
  useEffect(() => {
    if (optimizerConfig?.enabled) return;
    if (optimizerModel.trim()) return;
    if (availableTextModels.length === 0) return;

    setOptimizerModel(pickDefaultOptimizerModelId(availableTextModels));
  }, [availableTextModels, optimizerConfig?.enabled, optimizerModel]);

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
      showToast('请先填写 Base URL', 'error');
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

      // 如果有 API Key，直接带上 Authorization；否则先不带，失败后再重试
      let resp: Response;
      const hasApiKey = !!(settings.apiKey || variant === 'antigravity_tools');
      
      if (hasApiKey) {
        // 有 API Key，直接带上
        resp = await fetchModels(true);
      } else {
        // 没有 API Key，先不带 Authorization 尝试
        resp = await fetchModels(false);
        if ((resp.status === 401 || resp.status === 403)) {
          // 如果需要鉴权，提示用户
          throw new Error('该接口需要 API Key 鉴权，请先填写 API Key');
        }
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

      const textIds = uniqueIds.filter(isTextModelId);
      setAvailableTextModels(textIds);

      const modelsCache = {
        all: uniqueIds,
        image: geminiImageIds,
        text: textIds,
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

      const hints: string[] = [];
      if (geminiImageIds.length > 0) {
        hints.push(`${geminiImageIds.length} 个图像模型`);
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

      const updatedProvider: ProviderProfile = {
        ...activeProvider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        modelsCache: {
          all: activeProvider.modelsCache?.all || [],
          image: activeProvider.modelsCache?.image || [],
          text: activeProvider.modelsCache?.text || [],
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

    // 回退到页面自带配置
    if (!optimizerModel.trim()) {
      showToast('请先设置提示词优化模型', 'error');
      return;
    }
    if (!settings.apiKey) {
      showToast('请先填写 API Key', 'error');
      return;
    }
    if (!settings.baseUrl) {
      showToast('请先填写 Base URL', 'error');
      return;
    }

    setIsOptimizing(true);
    try {
      const newPrompt = await optimizePromptOpenAI(prompt, settings, optimizerModel);
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
    const model = customModel;
    if (!model.trim()) {
      showToast('请先填写模型名', 'error');
      return;
    }
    if (!settings.apiKey) {
      showToast('请先填写 API Key', 'error');
      return;
    }
    if (!settings.baseUrl) {
      showToast('请先填写 Base URL', 'error');
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
        // 将仍处于 pending 的卡片标记为“已停止”
        setGeneratedSlots((prev) =>
          prev.map((s) => (s.status === 'pending' ? { id: s.id, status: 'error', error: '已停止' } : s))
        );
        showToast('已停止生成', 'info');
        return;
      }

      showToast('生成错误：' + (error instanceof Error ? error.message : '未知错误'), 'error');
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

  const canGenerate =
    !!prompt.trim() &&
    !!customModel.trim() &&
    !!settings.baseUrl.trim() &&
    (!requiresApiKey || !!settings.apiKey.trim());

  return (
    <div className="h-full flex flex-col">
      {/* 上区：左侧配置 + 右侧图片展示 */}
      <div className="flex-1 min-h-0 p-4 flex flex-col md:flex-row gap-4">
        {/* 左侧：API 配置 */}
        <div className="w-full md:w-[280px] md:shrink-0 max-h-[40vh] md:max-h-none border border-dark-border rounded-xl bg-dark-surface/80 backdrop-blur-sm p-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-1.5">
            <Plug className="w-4 h-4 text-banana-500" />
            <span className="text-sm font-medium text-white">
              {variant === 'antigravity_tools' ? 'Antigravity' : 'API 设置'}
            </span>
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
              placeholder="sk-..."
              className="w-full h-9 text-sm bg-dark-bg border border-dark-border rounded-lg px-3 text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-banana-500"
            />
            {requiresApiKey && !settings.apiKey.trim() && (
              <p className="text-xs text-yellow-500/80">未填写 API Key，生成/增强将不可用。</p>
            )}
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">Base URL</label>
            <div className="flex items-center gap-1.5">
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
                className="flex-1 h-9 text-sm bg-dark-bg border border-dark-border rounded-lg px-3 text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-banana-500"
              />
              <button
                onClick={() => void handleRefreshModels()}
                disabled={isLoadingModels || !settings.baseUrl}
                className="h-9 px-2.5 text-xs rounded-lg border border-dark-border bg-dark-bg text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
                title={modelsHint || '刷新模型列表'}
              >
                {isLoadingModels ? '...' : '刷新'}
              </button>
            </div>
            {!settings.baseUrl.trim() && (
              <p className="text-xs text-yellow-500/80">未填写 Base URL，无法请求模型列表与生成。</p>
            )}
          </div>

          {/* Prompt 优化器配置（内联） */}
          <PromptOptimizerSettings onConfigChange={handleOptimizerConfigChange} />
        </div>

        {/* 右侧：图片展示 */}
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
      </div>

      {/* 下区：Prompt + 参数 + 生成（全宽） */}
      <div className="shrink-0 px-4 pb-4">
        <div className="border border-dark-border rounded-xl bg-dark-surface/80 backdrop-blur-sm p-4">
          <div className="flex flex-col lg:flex-row items-stretch gap-4 w-full overflow-hidden">
            {/* Prompt */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">提示词</span>
                <button
                  onClick={handleOptimizePrompt}
                  disabled={isOptimizing || !prompt || (!optimizerConfig?.enabled && !optimizerModel.trim())}
                  className="flex items-center gap-1 text-xs text-banana-500 hover:text-banana-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Wand2 className="w-3 h-3" />
                  {isOptimizing ? '优化中…' : '增强'}
                </button>
              </div>

              {!optimizerConfig?.enabled && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-500 shrink-0">优化模型</span>
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={optimizerModel}
                      onChange={(e) => setOptimizerModel(e.target.value)}
                      placeholder="gpt-4o-mini, claude-3-haiku..."
                      className="w-full h-8 text-xs bg-dark-bg border border-dark-border rounded-lg px-2 text-white outline-none focus:ring-1 focus:ring-banana-500 placeholder-gray-600"
                    />
                    {availableTextModels.length > 0 && (
                      <select
                        value={availableTextModels.includes(optimizerModel) ? optimizerModel : ''}
                        onChange={(e) => setOptimizerModel(e.target.value)}
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 max-w-[160px] bg-dark-bg border border-dark-border rounded px-0.5 text-xs text-gray-400 cursor-pointer"
                        title="从已刷新的文本模型中快速选择"
                      >
                        <option value="">...</option>
                        {availableTextModels.slice(0, 12).map((id) => (
                          <option key={id} value={id}>{id}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              )}
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
                    <input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="gemini-3-pro-image"
                      className="w-full h-8 text-xs bg-dark-bg border border-dark-border rounded-lg px-2 text-white outline-none focus:ring-1 focus:ring-banana-500 placeholder-gray-600"
                    />
                    {availableImageModels.length > 0 && (
                      <select
                        value={availableImageModels.includes(customModel) ? customModel : ''}
                        onChange={(e) => setCustomModel(e.target.value)}
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 bg-dark-bg border border-dark-border rounded px-0.5 text-xs text-gray-400 cursor-pointer"
                      >
                        <option value="">...</option>
                        {availableImageModels.slice(0, 5).map((id) => (
                          <option key={id} value={id}>{id.slice(0, 10)}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                {!isAntigravityTools && (
                  <>
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
                        >
                          {['1K', '2K', '4K'].map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                      </div>
                    </div>
                  </>
                )}
                {isAntigravityTools && inferredAntigravityConfig?.aspectRatio && (
                  <div className="col-span-2 flex items-end">
                    <span className="text-xs text-gray-500 bg-dark-bg/50 rounded-lg px-2 py-1.5">
                      推断: {inferredAntigravityConfig.imageSize} • {inferredAntigravityConfig.aspectRatio}
                    </span>
                  </div>
                )}
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
                    <span className="text-xs">{refImages.length}/4</span>
                  </button>
                  {/* 参考图弹出层 */}
                  {showRefPopover && (
                    <div className="absolute bottom-full right-0 mb-2 w-64 bg-dark-surface border border-dark-border rounded-lg p-3 shadow-xl z-10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-400">参考图 ({refImages.length}/4)</span>
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
