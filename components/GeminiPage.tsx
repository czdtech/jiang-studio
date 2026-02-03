import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, RefreshCw, Plus, ChevronDown, X, Star, Trash2, Sparkles, Image as ImageIcon } from 'lucide-react';
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
  BatchTask,
  BatchTaskStatus,
  BatchConfig,
} from '../types';
import { generateImages } from '../services/gemini';
import { optimizeUserPrompt } from '../services/mcp';
import { downloadImagesSequentially } from '../services/download';
import { useToast } from './Toast';
import { ImageGrid } from './ImageGrid';
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
  setPromptOptimizerConfig,
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
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const generationRunIdRef = useRef(0);
  const generateLockRef = useRef(false);
  const isMountedRef = useRef(false);
  const deletingProviderIdRef = useRef<string | null>(null); // 标记正在删除的供应商

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

  const handleIterateTemplateChange = useCallback((templateId: string) => {
    if (optimizerConfig) {
      const newConfig = { ...optimizerConfig, iterateTemplateId: templateId, updatedAt: Date.now() };
      setOptimizerConfig(newConfig);
      void setPromptOptimizerConfig(newConfig);
    }
  }, [optimizerConfig]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      try {
        abortControllerRef.current?.abort();
        batchAbortControllerRef.current?.abort();
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
    model: ModelType.NANO_BANANA,
  });

  // Results
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);

  // 批量任务状态
  const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const batchAbortRef = useRef(false);
  const [batchConfig, setBatchConfig] = useState<BatchConfig>(() => ({ concurrency: 2, countPerPrompt: 1 }));

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
      // 检查供应商是否正在被删除，避免竞态条件导致被删除的供应商被重新插入
      if (deletingProviderIdRef.current === next.id) return;
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

  const handleToggleFavorite = () => {
    setProviderFavorite((v) => !v);
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
    const apiKey = settings.apiKey?.trim();
    if (!apiKey) {
      showToast('请先填写 Gemini API Key', 'error');
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
      .map(line => line.trim())
      .filter(line => line.length > 0);
  };

  // 检测是否为批量模式（多行输入）
  const promptLines = parsePromptsToBatch(prompt);
  const detectedBatchMode = promptLines.length > 1;

  // 批量生成处理
  const handleBatchGenerate = async () => {
    if (generateLockRef.current) return;
    if (isGenerating) return;

    const prompts = parsePromptsToBatch(prompt);
    if (prompts.length === 0) return;

    const apiKey = settings.apiKey?.trim();
    if (!apiKey) {
      showToast('请先填写 Gemini API Key', 'error');
      return;
    }

    // 初始化批量任务
    const tasks: BatchTask[] = prompts.map(p => ({
      id: crypto.randomUUID(),
      prompt: p,
      status: 'pending' as BatchTaskStatus,
    }));

    // 共享 AbortController：用于中止所有进行中的批量请求
    const controller = new AbortController();
    batchAbortControllerRef.current = controller;

    setBatchTasks(tasks);
    setIsBatchMode(true);
    batchAbortRef.current = false;
    generateLockRef.current = true;
    setIsGenerating(true);
    setGeneratedImages([]);

    let successCount = 0;
    const safeConcurrency = Math.max(1, Math.min(6, Math.floor(batchConfig.concurrency || 1)));
    const safeCountPerPrompt = Math.max(1, Math.min(4, Math.floor(batchConfig.countPerPrompt || 1)));

    // 并发执行批量任务
    const runTask = async (task: BatchTask, index: number) => {
      if (batchAbortRef.current) return;
      if (controller.signal.aborted) return;

      // 更新状态为运行中
      setBatchTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: 'running' as BatchTaskStatus, startedAt: Date.now() } : t
      ));

      try {
        // 自动优化提示词（如果启用）
        let finalPrompt = task.prompt;
        if (optimizerConfig?.enabled && optimizerConfig.mode === 'auto') {
          try {
            finalPrompt = await optimizeUserPrompt(task.prompt, optimizerConfig.templateId);
          } catch {
            // 优化失败，使用原始提示词
          }
        }

        const currentParams: GenerationParams = {
          ...params,
          prompt: finalPrompt,
          referenceImages: refImages,
          count: safeCountPerPrompt, // 批量模式每个提示词生成多张
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

        if (batchAbortRef.current || controller.signal.aborted) return;

        const withSource = results.map(img => ({
          ...img,
          sourceScope: scope,
          sourceProviderId: activeProviderId,
        }));

        // 保存图片
        for (const img of withSource) {
          if (batchAbortRef.current || controller.signal.aborted) break;
          await saveImage(img);
        }

        // 更新任务状态为成功
        setBatchTasks(prev => prev.map(t =>
          t.id === task.id ? {
            ...t,
            status: 'success' as BatchTaskStatus,
            images: withSource,
            completedAt: Date.now()
          } : t
        ));

        // 添加到生成结果
        setGeneratedImages(prev => [...prev, ...withSource]);
        successCount++;
      } catch (error) {
        const aborted = (error as any)?.name === 'AbortError' || controller.signal.aborted;
        if (aborted) {
          setBatchTasks(prev => prev.map(t =>
            t.id === task.id ? {
              ...t,
              status: 'error' as BatchTaskStatus,
              error: '已取消',
              completedAt: Date.now()
            } : t
          ));
          return;
        }
        if (batchAbortRef.current) return;

        // 更新任务状态为失败
        setBatchTasks(prev => prev.map(t =>
          t.id === task.id ? {
            ...t,
            status: 'error' as BatchTaskStatus,
            error: error instanceof Error ? error.message : '生成失败',
            completedAt: Date.now()
          } : t
        ));
      }
    };

    // 使用并发控制执行任务
    const executeWithConcurrency = async () => {
      const queue = [...tasks];
      const running = new Set<Promise<void>>();

      while (queue.length > 0 || running.size > 0) {
        if (batchAbortRef.current || controller.signal.aborted) {
          // 等待已启动的任务尽快结束（通常会因 abort 而快速落地）
          await Promise.allSettled(Array.from(running));
          break;
        }

        // 填充到并发上限
        while (running.size < safeConcurrency && queue.length > 0) {
          const task = queue.shift()!;
          const index = tasks.findIndex(t => t.id === task.id);
          let promise: Promise<void>;
          promise = runTask(task, index).finally(() => {
            running.delete(promise);
          });
          running.add(promise);
        }

        // 等待任意一个完成
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
        // 标记未开始的任务为取消
        const now = Date.now();
        setBatchTasks(prev => prev.map(t =>
          t.status === 'pending' ? { ...t, status: 'error' as BatchTaskStatus, error: '已取消', completedAt: now } : t
        ));
      }

      if (batchAbortRef.current) {
        showToast('批量生成已停止', 'info');
      } else {
        showToast(`批量完成：${successCount}/${tasks.length} 成功`, successCount === tasks.length ? 'success' : 'info');
      }
    }
  };

  const handleBatchStop = () => {
    batchAbortRef.current = true;
    try {
      batchAbortControllerRef.current?.abort();
    } catch {
      // ignore
    }
    const now = Date.now();
    // 立即标记未开始的任务为取消（运行中的会在请求 abort 后进入 catch）
    setBatchTasks(prev => prev.map(t =>
      t.status === 'pending' ? { ...t, status: 'error' as BatchTaskStatus, error: '已取消', completedAt: now } : t
    ));
  };

  const handleClearBatch = () => {
    setBatchTasks([]);
    setIsBatchMode(false);
    setGeneratedImages([]);
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
              onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
              placeholder="AIza..."
              className={inputBaseStyles}
            />
            {!settings.apiKey.trim() && (
              <p className="text-xs text-yellow-500/80">
                未填写 API Key，无法生成/增强；请先配置后再开始。
              </p>
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
	          {/* 批量模式进度条 */}
	          {isBatchMode && batchTasks.length > 0 && (
	            <div className="mb-4 p-3 bg-dark-surface border border-dark-border rounded-lg">
	              <div className="flex items-center justify-between mb-2 gap-2">
	                <span className="text-sm text-gray-300">
	                  批量任务进度：{batchTasks.filter(t => t.status === 'success' || t.status === 'error').length}/{batchTasks.length}
	                </span>
	                <div className="flex items-center gap-2">
	                  <div className="flex gap-2 text-xs">
	                    <span className="text-green-400">{batchTasks.filter(t => t.status === 'success').length} 成功</span>
	                    <span className="text-red-400">{batchTasks.filter(t => t.status === 'error').length} 失败</span>
	                    <span className="text-gray-500">{batchTasks.filter(t => t.status === 'pending' || t.status === 'running').length} 进行中</span>
	                  </div>
	                  {isGenerating && (
	                    <button
	                      type="button"
	                      onClick={handleBatchStop}
	                      className="h-7 px-2 rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 transition-colors text-xs"
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
	                        className="h-7 px-2 rounded-lg border border-dark-border bg-dark-bg text-gray-300 hover:text-white hover:border-gray-600 transition-colors text-xs"
	                      >
	                        下载全部
	                      </button>
	                    )}
	                </div>
	              </div>
	              <div className="flex gap-1 flex-wrap">
	                {batchTasks.map((task, idx) => (
	                  <div
                    key={task.id}
                    className={`w-6 h-6 rounded text-xs flex items-center justify-center ${
                      task.status === 'success' ? 'bg-green-500/20 text-green-400' :
                      task.status === 'error' ? 'bg-red-500/20 text-red-400' :
                      task.status === 'running' ? 'bg-banana-500/20 text-banana-400 animate-pulse' :
                      'bg-dark-border text-gray-500'
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
            isGenerating={isGenerating}
            params={params}
            onImageClick={onImageClick}
            onEdit={onEdit}
          />
	        </div>

	        {/* 右侧：迭代助手 */}
	        <div className="hidden md:block">
	          <IterationAssistant
	            currentPrompt={prompt}
	            onUseVersion={setPrompt}
	            iterateTemplateId={optimizerConfig?.iterateTemplateId}
	            onTemplateChange={handleIterateTemplateChange}
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
                  <div className="relative">
                    <select
                      value={params.model}
                      onChange={(e) => setParams({ ...params, model: normalizeGeminiModel(e.target.value) })}
                      className={selectSmallStyles}
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
                          className={selectSmallStyles}
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
                          className={selectSmallStyles}
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

              {/* Count / 批量配置 + 参考图 */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  {detectedBatchMode ? (
                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-500 block">批量配置</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="text-[10px] text-gray-600 mb-1 block">并发</label>
                          <div className="relative">
                            <select
                              value={batchConfig.concurrency}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                if (!Number.isFinite(v)) return;
                                setBatchConfig((prev) => ({ ...prev, concurrency: v }));
                              }}
                              className={selectSmallStyles}
                              disabled={isGenerating}
                            >
                              {[1, 2, 3, 4, 5, 6].map((n) => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-600 mb-1 block">每提示词</label>
                          <div className="relative">
                            <select
                              value={batchConfig.countPerPrompt}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                if (!Number.isFinite(v)) return;
                                setBatchConfig((prev) => ({ ...prev, countPerPrompt: v }));
                              }}
                              className={selectSmallStyles}
                              disabled={isGenerating}
                            >
                              {[1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className="text-xs text-gray-500 mb-1 block">数量</label>
                      <div className="grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((n) => (
                          <button
                            key={n}
                            onClick={() => setParams({ ...params, count: n })}
                            className={getCountButtonStyles(params.count === n)}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {/* 参考图按钮 */}
                <div className="relative">
                  <label className="text-xs text-gray-500 mb-1 block">参考图</label>
                  <button
                    onClick={() => setShowRefPopover(!showRefPopover)}
                    className={getRefImageButtonStyles(refImages.length > 0)}
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
            <div className="w-full lg:w-[140px] lg:shrink-0 flex flex-col gap-1">
              {detectedBatchMode && (
                <span className="text-xs text-banana-400 text-center">
                  批量模式：{promptLines.length} 个任务
                </span>
              )}
              <button
                onClick={isGenerating ? (detectedBatchMode ? handleBatchStop : handleStop) : (detectedBatchMode ? handleBatchGenerate : handleGenerate)}
                disabled={!isGenerating && !canGenerate}
                className={getGenerateButtonStyles(canGenerate, isGenerating)}
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span className="text-xs">停止</span>
                  </>
                ) : detectedBatchMode ? (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span className="text-sm">批量生成</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span className="text-sm">生成</span>
                    <span className="text-xs opacity-70">×{params.count}</span>
                  </>
                )}
              </button>
              {isBatchMode && batchTasks.length > 0 && !isGenerating && (
                <button
                  onClick={handleClearBatch}
                  className="h-6 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  清除队列
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
