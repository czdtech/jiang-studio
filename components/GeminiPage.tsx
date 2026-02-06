import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, RefreshCw, Plus, ChevronDown, X, Star, Trash2, Sparkles, Image as ImageIcon, Wand2, ImagePlus } from 'lucide-react';
import {
  GeminiSettings,
  GeneratedImage,
  GenerationParams,
  ModelType,
  MODEL_PRESETS,
  ProviderProfile,
  ProviderScope,
  PromptOptimizerConfig,
} from '../types';
import { generateImages } from '../services/gemini';
import { optimizeUserPrompt } from '../services/mcp';
import { useToast } from './Toast';
import { ImageGrid } from './ImageGrid';
import { BatchImageGrid } from './BatchImageGrid';
import { PromptOptimizerSettings } from './PromptOptimizerSettings';
import { IterationAssistant } from './IterationAssistant';
import { SamplePromptChips } from './SamplePromptChips';
import {
  getFavoriteButtonStyles,
  getRefImageButtonStyles,
  inputBaseStyles,
  selectBaseStyles,
  selectSmallStyles,
} from './uiStyles';
import {
  getPromptOptimizerConfig,
  setPromptOptimizerConfig,
} from '../services/db';
import { useProviderManagement } from '../hooks/useProviderManagement';
import { useBatchGenerator } from '../hooks/useBatchGenerator';
import { parsePromptsToBatch, MAX_BATCH_TOTAL } from '../services/batch';

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

export const GeminiPage = ({ saveImage, onImageClick, onEdit }: GeminiPageProps) => {
  const { showToast } = useToast();
  const scope: ProviderScope = 'gemini';

  const abortControllerRef = useRef<AbortController | null>(null);
  const generateLockRef = useRef(false);
  const isMountedRef = useRef(false);

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
        setRefImages(draft.refImages || []);
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
      } catch {
        // ignore
      }
    };
  }, []);

  // Results
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);

  // Batch Hook
  const {
    batchTasks,
    isBatchMode,
    batchConfig,
    selectedBatchImageIds,
    isGenerating: isBatchGenerating,
    setBatchConfig,
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

  const batchPromptCount = useMemo(() => {
      const prompts = parsePromptsToBatch(prompt);
      const safeCountPerPrompt = Math.max(1, Math.min(4, Math.floor(batchConfig.countPerPrompt || 1)));
      const maxBatchPromptCount = Math.max(1, Math.floor(MAX_BATCH_TOTAL / safeCountPerPrompt));
      return Math.min(prompts.length, maxBatchPromptCount);
  }, [prompt, batchConfig.countPerPrompt]);

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
      const currentParams: GenerationParams = {
        ...params,
        prompt: finalPrompt,
        referenceImages: refImages,
        model: normalizeGeminiModel(params.model),
      };

      setGeneratedImages([]);

      const outcomes = await generateImages(
        currentParams,
        {
          apiKey,
          baseUrl: settingsBaseUrl || DEFAULT_GEMINI_BASE_URL,
        },
        { signal: controller.signal }
      );

      if (!isMountedRef.current) return;

      const successImages = outcomes
          .filter(o => o.ok)
          .map(o => (o as any).image as GeneratedImage)
          .map(img => ({
              ...img,
              sourceScope: scope,
              sourceProviderId: activeProviderId,
          }));

      const failErrors = outcomes
          .filter(o => !o.ok)
          .map(o => (o as any).error as string);

      setGeneratedImages(successImages);

      for (const img of successImages) {
        await saveImage(img);
      }

      const successCount = successImages.length;
      const failCount = currentParams.count - successCount;

      if (controller.signal.aborted) {
        showToast(successCount > 0 ? `已停止生成（已生成 ${successCount} 张）` : '已停止生成', 'info');
      } else if (successCount === 0) {
        showToast(`生成失败: ${failErrors[0] || '未知错误'}`, 'error');
      } else if (failCount > 0) {
        showToast(`生成完成：成功 ${successCount} 张，失败 ${failCount} 张`, 'info');
      } else {
        showToast('生成完成', 'success');
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      const aborted = (error as any)?.name === 'AbortError' || controller.signal.aborted;
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
    const maxImages = params.model === ModelType.NANO_BANANA_PRO ? 14 : 4;

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

  const maxRefImages = params.model === ModelType.NANO_BANANA_PRO ? 14 : 4;
  const canGenerate = !!prompt.trim() && !!settings.apiKey.trim();
  const isBusy = isGenerating || isBatchGenerating;

  return (
    <div className="aurora-page">
      {/* ========== 主行：侧边栏 + 画布 + 迭代助手 ========== */}
      <div className="aurora-main-row">
        {/* 左侧边栏：API 配置 */}
        <aside className="aurora-sidebar space-y-4">
          <div className="aurora-section-header">
            <Settings className="w-4 h-4 text-banana-500" />
            <span className="aurora-section-title">Gemini 设置</span>
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
        </aside>

        {/* 中间画布：图片展示 */}
        <div className="aurora-canvas">
          <div className="aurora-canvas-header">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-banana-500" />
              <span className="aurora-section-title">生成结果</span>
            </div>
            <span className="aurora-badge aurora-badge-gold">Nano Banana Pro</span>
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
              />
            ) : (
              <ImageGrid
                images={generatedImages}
                isGenerating={isGenerating}
                params={params}
                onImageClick={onImageClick}
                onEdit={onEdit}
              />
            )}
          </div>
        </div>

        {/* 右侧迭代助手 */}
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
        {/* 左列：提示词优化器（与侧边栏对齐） */}
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

        {/* 中列：提示词输入（与画布对齐） */}
        <div className="aurora-prompt-input">
          {/* 参考图行（大屏显示，位于输入框上方） */}
          <div className="aurora-ref-row">
            <label className="aurora-ref-add">
              <ImagePlus className="w-4 h-4" />
              <span>添加</span>
              <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
            </label>
            <div className="aurora-ref-count">{refImages.length}/{maxRefImages}</div>
            <div className="aurora-ref-list">
              {refImages.map((img, idx) => (
                <div key={idx} className="aurora-ref-thumb">
                  <img src={img} alt={`Ref ${idx + 1}`} />
                  <button
                    className="aurora-ref-remove"
                    onClick={() => removeRefImage(idx)}
                    aria-label="移除参考图"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 提示词输入区 */}
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
              <span className="text-xs">参考图 {refImages.length}/{maxRefImages}</span>
            </button>
            {showRefPopover && (
              <div className="absolute bottom-full left-0 mb-2 w-64 bg-graphite border border-ash rounded-[var(--radius-md)] p-3 shadow-[var(--shadow-floating)] z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted">参考图 ({refImages.length}/{maxRefImages})</span>
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

        {/* 右列：配置（与迭代助手对齐） */}
        <div className="aurora-prompt-config">
          {/* 模型（独占一行） */}
          <div>
            <label className="text-xs text-text-muted mb-1 block">模型</label>
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
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
            </div>
          </div>

          {/* 比例 + 尺寸（一行两列） */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-muted mb-1 block">比例</label>
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
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">尺寸</label>
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
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
              </div>
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
                提示词:{batchPromptCount}，每提示词:{safePreviewCountPerPrompt}， 图片数{batchPromptCount * safePreviewCountPerPrompt}
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
