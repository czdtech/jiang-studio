import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plug, RefreshCw, Plus, X, Star, Trash2, ChevronDown, Sparkles, Image as ImageIcon, Wand2 } from 'lucide-react';
import { GeneratedImage, GenerationParams, ModelType, PromptOptimizerConfig, ProviderDraft, ProviderProfile, ProviderScope, BatchTask, BatchTaskStatus, BatchConfig } from '../types';
import { generateImages, KieSettings } from '../services/kie';
import { optimizeUserPrompt } from '../services/mcp';
import { downloadImagesSequentially } from '../services/download';
import { useToast } from './Toast';
import { ImageGrid, ImageGridSlot } from './ImageGrid';
import { PromptOptimizerSettings } from './PromptOptimizerSettings';
import { IterationAssistant } from './IterationAssistant';
import { RefImageRow } from './RefImageRow';
import { SamplePromptChips } from './SamplePromptChips';
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

const MAX_REF_IMAGES = 8;
const MAX_BATCH_TOTAL = 32;
const MAX_BATCH_CONCURRENCY = 8;
const MAX_BATCH_COUNT_PER_PROMPT = 4;

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
  const [customModel, setCustomModel] = useState('nano-banana-pro');

  // 参考图弹出层
  const [showRefPopover, setShowRefPopover] = useState(false);

  // 模型列表
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsHint, setModelsHint] = useState<string>('');

  // 批量任务状态
  const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false); // 运行时状态：是否正在执行批量任务
  const [batchModeEnabled, setBatchModeEnabled] = useState(false); // 手动开关：是否启用批量模式
  const batchAbortRef = useRef(false);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const [batchConfig, setBatchConfig] = useState<BatchConfig>(() => ({ concurrency: 2, countPerPrompt: 1 }));

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

    // 加载模型缓存
    const cache = activeProvider.modelsCache;
    if (cache?.all?.length) {
      setAvailableModels(cache.all);
      const dt = new Date(cache.fetchedAt).toLocaleString();
      setModelsHint(`已缓存模型列表（${cache.all.length}） • ${dt}`);
    } else if (cache?.lastError) {
      setAvailableModels([]);
      setModelsHint(cache.lastError);
    } else {
      setAvailableModels([]);
      setModelsHint('');
    }

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

      const headers: Record<string, string> = {};
      if (settings.apiKey) {
        headers.Authorization = `Bearer ${settings.apiKey}`;
      }

      const resp = await fetch(url, { method: 'GET', headers });
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

      const modelsCache = {
        all: uniqueIds,
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

      setModelsHint(`已刷新模型列表（${uniqueIds.length}）`);
      showToast('Models refreshed', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown';
      const hint = `无法从 /v1/models 拉取模型列表：${msg}`;
      setModelsHint(hint);

      const updatedProvider: ProviderProfile = {
        ...activeProvider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        modelsCache: {
          all: activeProvider.modelsCache?.all || [],
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

  // 解析多行提示词为批量任务
  const parsePromptsToBatch = (text: string): string[] => {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  };

  // 批量模式下的任务数（用于 UI 显示）
  const safePreviewCountPerPrompt = Math.max(1, Math.min(MAX_BATCH_COUNT_PER_PROMPT, Math.floor(batchConfig.countPerPrompt || 1)));
  const maxBatchPromptCount = Math.max(1, Math.floor(MAX_BATCH_TOTAL / safePreviewCountPerPrompt));
  const batchPromptCount = batchModeEnabled ? Math.min(parsePromptsToBatch(prompt).length, maxBatchPromptCount) : 0;

  const handleBatchGenerate = async () => {
    if (generateLockRef.current) return;
    if (isGenerating) return;

    let prompts = parsePromptsToBatch(prompt);
    if (prompts.length === 0) return;

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

    const safeCountPerPrompt = Math.max(1, Math.min(MAX_BATCH_COUNT_PER_PROMPT, Math.floor(batchConfig.countPerPrompt || 1)));
    const maxPromptCount = Math.max(1, Math.floor(MAX_BATCH_TOTAL / safeCountPerPrompt));
    if (prompts.length > maxPromptCount) {
      prompts = prompts.slice(0, maxPromptCount);
      showToast(`批量模式一次最多生成 ${MAX_BATCH_TOTAL} 张，已截取前 ${maxPromptCount} 条提示词`, 'info');
    }

    // 初始化批量任务
    const tasks: BatchTask[] = prompts.map((p) => ({
      id: crypto.randomUUID(),
      prompt: p,
      status: 'pending' as BatchTaskStatus,
    }));

    const controller = new AbortController();
    batchAbortControllerRef.current = controller;
    batchAbortRef.current = false;

    setBatchTasks(tasks);
    setIsBatchMode(true);
    generateLockRef.current = true;
    setIsGenerating(true);

    // 批量模式用 images 渲染，不用 slots
    setGeneratedImages([]);
    setGeneratedSlots([]);

    let successCount = 0;
    const safeConcurrency = Math.max(1, Math.min(MAX_BATCH_CONCURRENCY, Math.floor(batchConfig.concurrency || 1)));

    const runTask = async (task: BatchTask) => {
      if (batchAbortRef.current || controller.signal.aborted) return;

      setBatchTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: 'running' as BatchTaskStatus, startedAt: Date.now() } : t
        )
      );

      try {
        // 自动优化提示词（如果启用）
        let finalPrompt = task.prompt;
        if (optimizerConfig?.enabled && optimizerConfig.mode === 'auto') {
          try {
            finalPrompt = await optimizeUserPrompt(task.prompt, optimizerConfig.templateId);
          } catch {
            // ignore
          }
        }

        const currentParams: GenerationParams = {
          ...params,
          prompt: finalPrompt,
          referenceImages: refImages,
          count: safeCountPerPrompt,
          model: model as ModelType,
        };

        const outcomes = await generateImages(currentParams, settings, { signal: controller.signal });

        const successImages = outcomes
          .filter((o): o is Extract<typeof outcomes[number], { ok: true }> => o.ok === true)
          .map((o) => ({
            ...o.image,
            sourceScope: scope,
            sourceProviderId: activeProviderId,
          }));

        const failErrors = outcomes
          .filter((o): o is Extract<typeof outcomes[number], { ok: false }> => o.ok === false)
          .map((o) => o.error)
          .filter((s) => typeof s === 'string' && s.length > 0);

        // 保存图片（成功的那部分）
        for (const img of successImages) {
          if (batchAbortRef.current || controller.signal.aborted) break;
          await saveImage(img);
        }

        // 更新任务状态
        if (successImages.length > 0) {
          setBatchTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? {
                    ...t,
                    status: 'success' as BatchTaskStatus,
                    images: successImages,
                    error: failErrors.length > 0 ? `部分失败：${failErrors[0]}` : undefined,
                    completedAt: Date.now(),
                  }
                : t
            )
          );
          setGeneratedImages((prev) => [...prev, ...successImages]);
          successCount++;
          return;
        }

        const aborted =
          controller.signal.aborted ||
          batchAbortRef.current ||
          (failErrors.length > 0 && failErrors.every((e) => e === '已停止'));

        setBatchTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: 'error' as BatchTaskStatus,
                  error: aborted ? '已取消' : (failErrors[0] || '生成失败'),
                  completedAt: Date.now(),
                }
              : t
          )
        );
      } catch (e) {
        const aborted = (e as any)?.name === 'AbortError' || controller.signal.aborted;
        if (aborted) {
          setBatchTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? { ...t, status: 'error' as BatchTaskStatus, error: '已取消', completedAt: Date.now() }
                : t
            )
          );
          return;
        }

        setBatchTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: 'error' as BatchTaskStatus,
                  error: e instanceof Error ? e.message : '生成失败',
                  completedAt: Date.now(),
                }
              : t
          )
        );
      }
    };

    const executeWithConcurrency = async () => {
      const queue = [...tasks];
      const running = new Set<Promise<void>>();

      while (queue.length > 0 || running.size > 0) {
        if (batchAbortRef.current || controller.signal.aborted) {
          await Promise.allSettled(Array.from(running));
          break;
        }

        while (running.size < safeConcurrency && queue.length > 0) {
          const task = queue.shift()!;
          let p: Promise<void>;
          p = runTask(task).finally(() => running.delete(p));
          running.add(p);
        }

        if (running.size > 0) {
          await Promise.race(Array.from(running));
        }
      }
    };

    try {
      await executeWithConcurrency();
    } finally {
      generateLockRef.current = false;
      setIsGenerating(false);
      batchAbortControllerRef.current = null;

      if (batchAbortRef.current || controller.signal.aborted) {
        const now = Date.now();
        setBatchTasks((prev) =>
          prev.map((t) =>
            t.status === 'pending'
              ? { ...t, status: 'error' as BatchTaskStatus, error: '已取消', completedAt: now }
              : t
          )
        );
        showToast('批量生成已停止', 'info');
      } else {
        showToast(`批量完成：${successCount}/${tasks.length} 成功`, successCount === tasks.length ? 'success' : 'info');
      }
    }
  };

  const handleBatchStop = () => {
    if (!isGenerating) return;
    batchAbortRef.current = true;
    try {
      batchAbortControllerRef.current?.abort();
    } catch {
      // ignore
    }
    const now = Date.now();
    setBatchTasks((prev) =>
      prev.map((t) =>
        t.status === 'pending'
          ? { ...t, status: 'error' as BatchTaskStatus, error: '已取消', completedAt: now }
          : t
      )
    );
  };

  const handleClearBatch = () => {
    setBatchTasks([]);
    setIsBatchMode(false);
    setGeneratedImages([]);
    setGeneratedSlots([]);
  };

  const handleBatchDownloadAll = async () => {
    if (isGenerating) return;
    const images = batchTasks.flatMap((t) => t.images || []);
    if (images.length === 0) return;

    try {
      const n = await downloadImagesSequentially(images, { delayMs: 140 });
      showToast(`已开始下载 ${n} 张`, 'success');
    } catch (e) {
      showToast('批量下载失败：' + (e instanceof Error ? e.message : '未知错误'), 'error');
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
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={settings.baseUrl}
                onChange={(e) => {
                  const next = e.target.value;
                  setSettings((prev) => ({ ...prev, baseUrl: next }));
                  setAvailableModels([]);
                  setModelsHint('');
                }}
                placeholder="https://api.kie.ai"
                className={`flex-1 ${inputBaseStyles}`}
              />
              <button
                onClick={() => void handleRefreshModels()}
                disabled={isLoadingModels || !settings.baseUrl}
                className="h-9 px-2.5 text-xs rounded-[var(--radius-md)] border border-ash bg-void text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
                title={modelsHint || '刷新模型列表'}
              >
                {isLoadingModels ? '...' : '刷新'}
              </button>
            </div>
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
            <span className="aurora-badge aurora-badge-gold">Kie AI</span>
          </div>
          <div className="aurora-canvas-body">
            {/* 批量模式进度条 */}
            {isBatchMode && batchTasks.length > 0 && (
              <div className="aurora-batch-progress">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-sm text-text-secondary">
                    批量任务进度：{batchTasks.filter(t => t.status === 'success' || t.status === 'error').length}/{batchTasks.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-2 text-xs">
                      <span className="text-success">{batchTasks.filter(t => t.status === 'success').length} 成功</span>
                      <span className="text-error">{batchTasks.filter(t => t.status === 'error').length} 失败</span>
                      <span className="text-text-muted">{batchTasks.filter(t => t.status === 'pending' || t.status === 'running').length} 进行中</span>
                    </div>
                    {isGenerating && (
                      <button
                        type="button"
                        onClick={handleBatchStop}
                        className="h-7 px-2 rounded-[var(--radius-md)] border border-error/40 bg-error/10 text-error hover:bg-error/20 transition-colors text-xs"
                      >
                        取消
                      </button>
                    )}
                    {!isGenerating &&
                      batchTasks.every(t => t.status === 'success' || t.status === 'error') &&
                      batchTasks.some(t => (t.images?.length || 0) > 0) && (
                        <button
                          type="button"
                          onClick={() => void handleBatchDownloadAll()}
                          className="h-7 px-2 rounded-[var(--radius-md)] border border-ash bg-void text-text-secondary hover:text-text-primary hover:border-smoke transition-colors text-xs"
                        >
                          下载全部
                        </button>
                      )}
                  </div>
                </div>
                <div className="aurora-batch-items">
                  {batchTasks.map((task, idx) => (
                    <div
                      key={task.id}
                      className={`aurora-batch-item ${
                        task.status === 'success' ? 'success' :
                        task.status === 'error' ? 'error' :
                        task.status === 'running' ? 'running' :
                        'pending'
                      }`}
                      title={task.prompt}
                    >
                      {idx + 1}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ImageGrid
              images={generatedImages}
              slots={isBatchMode ? undefined : generatedSlots}
              isGenerating={isGenerating}
              params={params}
              expectedCount={isBatchMode ? batchPromptCount * safePreviewCountPerPrompt : undefined}
              onImageClick={onImageClick}
              onEdit={onEdit}
            />
          </div>
        </div>

        {/* 右侧迭代助手（≥1200px 才显示） */}
        <aside className="aurora-assistant">
          <IterationAssistant
            currentPrompt={prompt}
            onUseVersion={setPrompt}
            iterateTemplateId={optimizerConfig?.iterateTemplateId}
            onTemplateChange={handleIterateTemplateChange}
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
                <label className="flex items-center justify-center h-8 text-xs text-text-muted hover:text-text-primary border border-dashed border-ash hover:border-banana-500/50 rounded-[var(--radius-md)] cursor-pointer transition-colors">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  添加参考图
                  <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                </label>
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
              <input
                type="text"
                list="kie-models-list"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="nano-banana-pro"
                className={`${inputBaseStyles} pr-8`}
              />
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
              {availableModels.length > 0 && (
                <datalist id="kie-models-list">
                  {availableModels.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              )}
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

          {/* 模式切换 (分段控制器) */}
          <div className="mb-3">
            <label className="text-xs text-text-muted mb-2 block font-medium">生成模式</label>
            <div className="bg-slate border border-ash rounded-[var(--radius-md)] p-1 flex relative">
              <button
                type="button"
                onClick={() => setBatchModeEnabled(false)}
                disabled={isGenerating}
                className={`flex-1 py-2 text-xs font-semibold rounded-[var(--radius-sm)] transition-all duration-200 z-10 ${
                  !batchModeEnabled
                    ? 'text-obsidian'
                    : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                普通生成
              </button>
              <button
                type="button"
                onClick={() => setBatchModeEnabled(true)}
                disabled={isGenerating}
                className={`flex-1 py-2 text-xs font-semibold rounded-[var(--radius-sm)] transition-all duration-200 z-10 ${
                  batchModeEnabled
                    ? 'text-obsidian'
                    : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                批量任务
              </button>
              <div
                className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-banana-500 rounded-[var(--radius-sm)] shadow-[var(--shadow-lifted)] transition-all duration-300 ease-spring ${
                  batchModeEnabled ? 'left-[calc(50%+2px)]' : 'left-1'
                }`}
              />
            </div>
          </div>

          {/* 模式内容区 */}
          {batchModeEnabled ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-text-muted mb-1 block">并发数</label>
                <div className="relative">
                  <select
                    value={batchConfig.concurrency}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < 1 || v > MAX_BATCH_CONCURRENCY) return;
                      setBatchConfig((prev) => ({ ...prev, concurrency: v }));
                    }}
                    className={selectSmallStyles}
                    disabled={isGenerating}
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
                      if (!Number.isFinite(v) || v < 1 || v > MAX_BATCH_COUNT_PER_PROMPT) return;
                      setBatchConfig((prev) => ({ ...prev, countPerPrompt: v }));
                    }}
                    className={selectSmallStyles}
                    disabled={isGenerating}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs text-text-muted mb-1 block">生成数量</label>
              <div className="aurora-count-buttons">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setParams((prev) => ({ ...prev, count: n }))}
                    className={`aurora-count-btn ${params.count === n ? 'active' : ''}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 生成按钮 */}
          <div className="mt-auto space-y-1">
            {batchModeEnabled && batchPromptCount > 0 && (
              <span className="text-xs text-banana-500 text-center block">
                批量模式：{batchPromptCount} 个任务
              </span>
            )}
            <button
              onClick={isGenerating ? (batchModeEnabled ? handleBatchStop : handleStop) : (batchModeEnabled ? handleBatchGenerate : handleGenerate)}
              disabled={!isGenerating && !canGenerate}
              className={`aurora-generate-btn ${isGenerating ? 'stopping' : ''}`}
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>停止</span>
                </>
              ) : batchModeEnabled ? (
                <>
                  <Sparkles className="w-5 h-5" />
                  <span>批量生成</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  <span>生成 ×{params.count}</span>
                </>
              )}
            </button>
            {isBatchMode && batchTasks.length > 0 && !isGenerating && (
              <button
                onClick={handleClearBatch}
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
