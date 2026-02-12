import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, RefreshCw, Plus, ChevronDown, ChevronRight, X, Star, Trash2, Sparkles, Image as ImageIcon, Wand2, ImagePlus, FolderOpen, History } from 'lucide-react';
import {
  GeminiSettings,
  GeneratedImage,
  GenerationParams,
  ModelType,
  MODEL_PRESETS,
  ProviderProfile,
  ProviderScope,
  PromptOptimizerConfig,
  IterationAssistantConfig,
  IterationContext,
  IterationMode,
} from '../types';
import { generateImages } from '../services/gemini';
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
} from './uiStyles';
import {
  getPromptOptimizerConfig,
  getIterationAssistantConfig,
  getRecentImagesByScope,
} from '../services/db';
import { compressImage, readFilesAsDataUrls } from '../services/shared';
import { useProviderManagement } from '../hooks/useProviderManagement';
import { useBatchGenerator } from '../hooks/useBatchGenerator';
import { parsePromptsToBatch } from '../services/batch';

interface GeminiPageProps {
  saveImage: (image: GeneratedImage) => Promise<void>;
  ensureGalleryDir: () => Promise<boolean>;
  onImageClick: (images: GeneratedImage[], index: number) => void;
  onEdit: (image: GeneratedImage) => void;
}

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

const normalizeGeminiModel = (value: unknown): ModelType => {
  if (value === ModelType.NANO_BANANA_PRO) return ModelType.NANO_BANANA_PRO;
  if (value === ModelType.NANO_BANANA) return ModelType.NANO_BANANA;
  return ModelType.NANO_BANANA_PRO;
};

const createDefaultProvider = (scope: ProviderScope): ProviderProfile => {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    scope,
    name: 'Gemini 官方',
    apiKey: '',
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    defaultModel: ModelType.NANO_BANANA_PRO,
    favorite: true,
    createdAt: now,
    updatedAt: now,
  };
};

export const GeminiPage = ({ saveImage, ensureGalleryDir, onImageClick, onEdit }: GeminiPageProps) => {
  const { showToast } = useToast();
  const scope: ProviderScope = 'gemini';

  const abortControllerRef = useRef<AbortController | null>(null);
  const generateLockRef = useRef(false);
  const isMountedRef = useRef(false);
  const historyRef = useRef<HTMLDivElement>(null);

  // Generator State
  const [prompt, setPrompt] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);

  // Params
  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    count: 1,
    model: ModelType.NANO_BANANA,
  });

  const {
    providers,
    activeProviderId,
    apiKey: settingsApiKey,
    setApiKey,
    baseUrl: settingsBaseUrl,
    setBaseUrl,
    providerName,
    setProviderName,
    providerFavorite,
    handleSelectProvider,
    handleCreateProvider,
    handleDeleteProvider,
    toggleFavorite,
  } = useProviderManagement({
    scope,
    createDefaultProvider,
    onDraftLoaded: useCallback((draft, defaultModel) => {
      if (draft) {
        setPrompt(draft.prompt || '');
        setParams({
          ...draft.params,
          model: normalizeGeminiModel(draft.params?.model),
        });
        if (draft.refImages && draft.refImages.length > 0) {
          void Promise.all(draft.refImages.map(img => compressImage(img))).then(setRefImages);
        } else {
          setRefImages([]);
        }
      } else {
        setPrompt('');
        setRefImages([]);

        const nextModel = normalizeGeminiModel(defaultModel);
        setParams({
          prompt: '',
          aspectRatio: '1:1',
          imageSize: '1K',
          count: 1,
          model: nextModel,
        });
      }
    }, []),
    draftState: {
      prompt,
      params,
      refImages,
      model: String(params.model),
    },
  });

  // Derived settings object for compatibility
  const settings: GeminiSettings = useMemo(() => ({
    apiKey: settingsApiKey,
    baseUrl: settingsBaseUrl === DEFAULT_GEMINI_BASE_URL ? undefined : settingsBaseUrl,
  }), [settingsApiKey, settingsBaseUrl]);

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
  const portfolioTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const refPanelRef = useRef<HTMLDivElement>(null);

  // 独立的 Prompt 优化器配置
  const [optimizerConfig, setOptimizerConfig] = useState<PromptOptimizerConfig | null>(null);
  // 独立的迭代助手配置
  const [iterationConfig, setIterationConfig] = useState<IterationAssistantConfig | null>(null);

  // 初始化加载配置（优化器 + 迭代助手并行）
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [optConfig, iterConfig] = await Promise.all([
        getPromptOptimizerConfig(),
        getIterationAssistantConfig(),
      ]);
      if (cancelled) return;
      if (optConfig?.enabled) {
        setOptimizerConfig(optConfig);
      }
      setIterationConfig(iterConfig);
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

  // Results: 本轮生成 + 历史记录（折叠）
  const [currentImages, setCurrentImages] = useState<GeneratedImage[]>([]);
  const [generatedSlots, setGeneratedSlots] = useState<ImageGridSlot[]>([]);
  const [historyImages, setHistoryImages] = useState<GeneratedImage[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [apiConfigExpanded, setApiConfigExpanded] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const refreshHistory = useCallback(() => setHistoryVersion(v => v + 1), []);

  // 从 Portfolio 恢复历史生成记录
  useEffect(() => {
    if (!activeProviderId) return;
    let cancelled = false;
    void getRecentImagesByScope(scope).then(images => {
      if (cancelled) return;
      setHistoryImages(images);
    });
    return () => { cancelled = true; };
  }, [activeProviderId, historyVersion]);

  // 历史记录展开时自动滚动
  useEffect(() => {
    if (historyExpanded && historyRef.current) {
      // 等待 DOM 渲染完成后再滚动
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
    ensureGalleryDir,
    scope,
    activeProviderId,
    onImagesSaved: refreshHistory
  });

  const handleIterationGenerate = useCallback(async (optimizedPrompt: string, context: IterationContext) => {
    if (generateLockRef.current || isGenerating) return;

    const apiKey = settingsApiKey?.trim();
    if (!apiKey) {
      showToast('请先填写 Gemini API Key', 'error');
      return;
    }

    // 更新主输入框
    setPrompt(optimizedPrompt);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    generateLockRef.current = true;
    setIsGenerating(true);

    try {
      const currentParams: GenerationParams = {
        ...(context.targetImage?.params || params),
        prompt: optimizedPrompt,
        referenceImages: refImages,
        model: normalizeGeminiModel(params.model),
        count: 1,
      };

      const outcomes = await generateImages(currentParams, {
        apiKey,
        baseUrl: settingsBaseUrl || DEFAULT_GEMINI_BASE_URL,
      }, { signal: controller.signal });

      if (!isMountedRef.current) return;

      const successImages = outcomes
        .filter(o => o.ok)
        .map(o => (o as { ok: true; image: GeneratedImage }).image)
        .map(img => ({ ...img, sourceScope: scope, sourceProviderId: activeProviderId }));

      if (successImages.length === 0) {
        showToast('迭代生成失败', 'error');
        return;
      }

      // 批量模式：追加到原图所在的 batch task 中（同行显示）
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
      refreshHistory();

      showToast(`迭代生成完成（${successImages.length} 张新图）`, 'success');
    } catch (error) {
      if (!isMountedRef.current) return;
      const aborted = (error as { name?: string })?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        showToast('已停止生成', 'info');
        return;
      }
      showToast('生成错误：' + (error instanceof Error ? error.message : '未知错误'), 'error');
    } finally {
      generateLockRef.current = false;
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [params, refImages, settingsApiKey, settingsBaseUrl, scope, activeProviderId, saveImage, showToast, isGenerating, isBatchMode, setBatchTasks, refreshHistory]);

  const batchPromptCount = useMemo(() => parsePromptsToBatch(prompt).length, [prompt]);

  const handleBatchGenerate = async () => {
    if (generateLockRef.current) return;

    const apiKey = settingsApiKey?.trim();
    if (!apiKey) {
      showToast('请先填写 Gemini API Key', 'error');
      return;
    }

    const baseParams: GenerationParams = {
        ...params,
        referenceImages: refImages,
        model: normalizeGeminiModel(params.model),
    };

    await startBatch(
        prompt,
        baseParams,
        (p, signal) => generateImages(p, {
            apiKey,
            baseUrl: settingsBaseUrl || DEFAULT_GEMINI_BASE_URL,
        }, { signal }),
        optimizerConfig
    );
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
    if (isBatchGenerating) return; // Should not happen due to UI logic but good safety
    if (generateLockRef.current) return;
    if (isGenerating) return;
    if (!prompt.trim()) return;

    // Gallery guard: 确保图库目录已设置
    const galleryOk = await ensureGalleryDir();
    if (!galleryOk) return;

    if (isBatchMode) {
        clearBatch();
    }

    const apiKey = settingsApiKey?.trim();
    if (!apiKey) {
      showToast('请先填写 Gemini API Key', 'error');
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
        model: normalizeGeminiModel(params.model),
        count: safePreviewCountPerPrompt,
      };

      // 生成前创建 pending slots
      const slotIds = Array.from({ length: currentParams.count }, () => crypto.randomUUID());
      setGeneratedSlots(slotIds.map((id) => ({ id, status: 'pending' })));

      const outcomes = await generateImages(
        currentParams,
        {
          apiKey,
          baseUrl: settingsBaseUrl || DEFAULT_GEMINI_BASE_URL,
        },
        { signal: controller.signal }
      );

      if (!isMountedRef.current) return;

      // 将 outcomes 映射到 slots
      const nextSlots: ImageGridSlot[] = outcomes.map((o, i) => {
        if (o.ok === true) {
          const withSource: GeneratedImage = {
            ...o.image,
            sourceScope: scope,
            sourceProviderId: activeProviderId,
          };
          return { id: slotIds[i], status: 'success' as const, image: withSource };
        }
        return { id: slotIds[i], status: 'error' as const, error: o.error };
      });

      const successImages = nextSlots
        .filter((s): s is Extract<ImageGridSlot, { status: 'success' }> => s.status === 'success')
        .map((s) => s.image);

      setGeneratedSlots(nextSlots);
      setCurrentImages(prev => [...successImages, ...prev]);

      for (const img of successImages) {
        await saveImage(img);
      }
      refreshHistory();

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
      const aborted = (error as any)?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        setGeneratedSlots((prev) =>
          prev.map((s) => (s.status === 'pending' ? { id: s.id, status: 'error' as const, error: '已停止' } : s))
        );
        showToast('已停止生成', 'info');
        return;
      }
      showToast('生成错误：' + (error instanceof Error ? error.message : '未知错误'), 'error');
    } finally {
      generateLockRef.current = false;
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

    const maxImages = params.model === ModelType.NANO_BANANA_PRO ? 14 : 4;
    try {
      const rawImages = await readFilesAsDataUrls(Array.from(fileList));
      const newImages = await Promise.all(rawImages.map(img => compressImage(img)));
      setRefImages((prev) => [...prev, ...newImages].slice(0, maxImages));
    } catch (err) {
      showToast('图片上传失败', 'error');
    }

    // 清空 input value，允许重复上传相同文件
    e.target.value = '';
  };

  // 切换模型时裁剪参考图
  useEffect(() => {
    const maxImages = params.model === ModelType.NANO_BANANA_PRO ? 14 : 4;
    if (refImages.length > maxImages) {
      setRefImages(prev => prev.slice(0, maxImages));
      showToast(`当前模型最多支持 ${maxImages} 张参考图`, 'info');
    }
  }, [params.model, refImages.length]);

  const removeRefImage = (index: number) => {
    setRefImages((prev) => prev.filter((_, i) => i !== index));
  };

  const addRefImages = useCallback(async (dataUrls: string[]) => {
    const max = params.model === ModelType.NANO_BANANA_PRO ? 14 : 4;
    const compressed = await Promise.all(dataUrls.map(img => compressImage(img)));
    setRefImages((prev) => [...prev, ...compressed].slice(0, max));
  }, [params.model]);

  const maxRefImages = params.model === ModelType.NANO_BANANA_PRO ? 14 : 4;
  const canGenerate = !!prompt.trim() && !!settings.apiKey.trim();
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
            <span className="aurora-section-title flex-1">Gemini 设置</span>
            {!settingsApiKey.trim() && (
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
                  value={settingsApiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIza..."
                  className={inputBaseStyles}
                  autoComplete="off"
                />
                {!settingsApiKey.trim() && (
                  <p className="text-xs text-warning/80">
                    未填写 API Key，无法生成。
                  </p>
                )}
              </form>

              {/* Base URL（高级） */}
              <div className="space-y-2">
                <label className="text-xs text-text-muted flex items-center gap-1">
                  Base URL
                  <span className="text-[10px] text-text-disabled">(可选)</span>
                </label>
                <input
                  type="text"
                  value={settingsBaseUrl || ''}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="默认官方地址"
                  className={inputBaseStyles}
                />
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

        {/* 中间画布：图片展示 + 悬浮提示词 */}
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
              <span className="aurora-badge aurora-badge-gold">Nano Banana Pro</span>
            </div>
          </div>
          <div className={`aurora-canvas-body ${isBatchMode ? 'aurora-canvas-body-batch' : ''}`} style={{ paddingBottom: '240px' }}>
            {historyExpanded && historyImages.length > 0 ? (
              /* 历史记录浮层：覆盖替换主内容区域 */
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
                      params={params}
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
                  <ImageGrid
                    images={currentImages}
                    slots={generatedSlots}
                    isGenerating={isGenerating}
                    params={params}
                    onImageClick={onImageClick}
                    onEdit={onEdit}
                    onIterate={handleIterate}
                  />
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
                    <span className="text-xs text-text-muted">参考图 ({refImages.length}/{maxRefImages})</span>
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
            {!settingsApiKey.trim() && (
              <p className="mt-2 text-xs text-warning/80">
                未填写 API Key，无法生成。
              </p>
            )}
            {!prompt.trim() && <SamplePromptChips onPick={setPrompt} />}

            {/* 配置栏 + 生成按钮 */}
            <div className="aurora-config-bar">
              <div className="aurora-config-item">
                <label>模型</label>
                <select
                  value={params.model}
                  onChange={(e) => setParams({ ...params, model: normalizeGeminiModel(e.target.value) })}
                >
                  {MODEL_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>{preset.label}</option>
                  ))}
                </select>
              </div>
              <div className="aurora-config-item">
                <label>比例</label>
                <select
                  value={params.aspectRatio}
                  onChange={(e) => setParams({ ...params, aspectRatio: e.target.value as GenerationParams['aspectRatio'] })}
                >
                  {['1:1', '2:3', '3:2', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9'].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="aurora-config-item">
                <label>尺寸</label>
                <select
                  value={params.imageSize}
                  onChange={(e) => setParams({ ...params, imageSize: e.target.value as GenerationParams['imageSize'] })}
                  disabled={params.model !== ModelType.NANO_BANANA_PRO}
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
            iterateTemplateId={iterationConfig?.templateId}
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
