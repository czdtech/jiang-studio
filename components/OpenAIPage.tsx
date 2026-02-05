import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Plus, ChevronDown, X, Plug, Star, Trash2, Sparkles, Image as ImageIcon, Wand2 } from 'lucide-react';
import {
  OpenAISettings,
  GeneratedImage,
  GenerationParams,
  ModelType,
  ProviderProfile,
  ProviderScope,
  ProviderDraft,
  PromptOptimizerConfig,
  BatchTask,
  BatchTaskStatus,
  BatchConfig,
} from '../types';
import { generateImages } from '../services/openai';
import { optimizeUserPrompt } from '../services/mcp';
import { downloadImagesSequentially } from '../services/download';
import { useToast } from './Toast';
import { ImageGrid, ImageGridSlot } from './ImageGrid';
import { BatchImageGrid } from './BatchImageGrid';
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

import { useGenerationSettings } from '../contexts/GenerationSettingsContext';

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
    baseUrl: '',
    defaultModel: 'gemini-3-pro-image',
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
};

const MAX_REF_IMAGES = 8;
const MAX_BATCH_TOTAL = 32;
const MAX_BATCH_CONCURRENCY = 8;
const MAX_BATCH_COUNT_PER_PROMPT = 4;

export const OpenAIPage = ({ saveImage, onImageClick, onEdit, variant = 'third_party' }: OpenAIPageProps) => {
  const { showToast } = useToast();
  const scope: ProviderScope = variant === 'antigravity_tools' ? 'antigravity_tools' : 'openai_proxy';
  const isAntigravityTools = variant === 'antigravity_tools';

  const {
    activeProviderId,
    params, updateParams,
    customModel,
    optimizerConfig,
    batchConfig,
    setPrompt: setContextPrompt, // Optional if we want global prompt, but usually prompt is local to page? 
    // Actually Context has 'params', maybe prompt is inside params?
    // Let's check context definition. Context has 'params' which includes 'prompt'. 
    // But OpenAIPage usually has a controlled input 'prompt' state.
    // Let's keep local prompt sync with context params.prompt?
    // Or just use local prompt and sync on generate?
    // For now, let's keep local prompt state to avoid context jitter on every keystroke, 
    // or use the one from context if we want it persisted. 
    // Context definition: params: GenerationParams. includes prompt.
  } = useGenerationSettings();

  // Sync local prompt with context params if needed, or just use context params.
  // To avoid lag, we often keep local state and sync on blur/generate.
  // But let's verify what 'params' consists of.
  
  // We need 'settings' (apiKey/baseUrl) for API calls.
  const [settings, setSettings] = useState<OpenAISettings>({ apiKey: '', baseUrl: '' });
  const [activeProviderName, setActiveProviderName] = useState('');

  // Load API settings when activeProviderId changes
  useEffect(() => {
    const loadSettings = async () => {
      if (!activeProviderId) return;
      const providers = await getProvidersFromDb(scope);
      const p = providers.find(x => x.id === activeProviderId);
      if (p) {
        setSettings({ apiKey: p.apiKey, baseUrl: p.baseUrl });
        setActiveProviderName(p.name);
      }
    };
    loadSettings();
  }, [activeProviderId, scope]);

  // We can keep 'prompt' local for input performance, 
  // but if we want 'cross-page' persistence, we should sync with context.
  const [prompt, setPrompt] = useState('');
  
  // Initialize prompt from context or DB draft
  useEffect(() => {
     // If context has a prompt, use it? code below handles draft loading.
  }, []);

  const isHydratingRef = useRef(false);
  const hydratedProviderIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const batchAbortRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const generationRunIdRef = useRef(0);
  const generateLockRef = useRef(false);
  const isMountedRef = useRef(false);
  const deletingProviderIdRef = useRef<string | null>(null); // 标记正在删除的供应商

  useEffect(() => {
    // React StrictMode(dev) 会执行一次“mount->unmount->mount”来检测副作用；这里必须在 effect 中显式置 true。
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



  const [isGenerating, setIsGenerating] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]); // Keep local for now? Context params has referenceImages.
  
  // Ref Image Popover
  const [showRefPopover, setShowRefPopover] = useState(false);

  // Results
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [generatedSlots, setGeneratedSlots] = useState<ImageGridSlot[]>([]);

  // Batch
  const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedBatchImageIds, setSelectedBatchImageIds] = useState<string[]>([]);

  const inferredAntigravityConfig = useMemo(() => {
    if (!isAntigravityTools) return null;
    return inferAntigravityImageConfigFromModelId(customModel);
  }, [customModel, isAntigravityTools]);

  // Load draft
  useEffect(() => {
    if (!activeProviderId) return;
    if (isHydratingRef.current) return;
    
    // Simple draft loading - syncing DB draft to local state
    const loadDraft = async () => {
       isHydratingRef.current = true;
       try {
         const draft = await getDraftFromDb(scope, activeProviderId);
         if (draft) {
           setPrompt(draft.prompt || '');
           setRefImages(draft.refImages || []);
           // Params and model are handled by Context ideally, 
           // but for now let's assume Context is the source of truth for 'global settings' 
           // and draft is for 'content' (prompt/refImages)
         }
       } catch (e) {
         console.warn("Failed to load draft", e);
       } finally {
         isHydratingRef.current = false;
       }
    };
    loadDraft();
  }, [activeProviderId, scope]);

  // Save Draft (Prompt & RefImages)
  useEffect(() => {
    if (!activeProviderId) return;
    if (isHydratingRef.current) return;

    const t = setTimeout(() => {
      upsertDraftInDb({
         scope,
         providerId: activeProviderId,
         prompt,
         params,     // sync current context params to draft
         refImages,
         model: customModel,
         updatedAt: Date.now()
      }).catch(console.error);
    }, 500);
    return () => clearTimeout(t);
  }, [activeProviderId, scope, prompt, params, refImages, customModel]);



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

    // 切回单条生成时，清理批量状态，避免 UI/slots 冲突
    if (isBatchMode) {
      setIsBatchMode(false);
      setBatchTasks([]);
    }

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
      if (generationRunIdRef.current === runId) generateLockRef.current = false;
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

  // 解析多行提示词为批量任务
  /**
   * 解析多行提示词为批量任务
   * - 使用 --- 分隔符明确区分多个提示词
   * - JSON/结构化文本自动识别为单个提示词
   * - 普通多行文本按行分割
   */
  const parsePromptsToBatch = (text: string): string[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];

    // 1. 优先检测是否使用了分隔符 ---
    if (trimmed.includes('\n---\n') || trimmed.includes('\n---')) {
      return trimmed
        .split(/\n-{3,}\n?/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    // 2. 检测是否是 JSON 格式（以 { 或 [ 开头）
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return [trimmed];
    }

    // 3. 检测是否包含多行结构化内容（如缩进、引号、括号开头）
    const lines = trimmed.split('\n');
    const hasStructuredContent = lines.some(
      (line) =>
        line.startsWith('  ') ||
        line.startsWith('\t') ||
        /^\s*["'{[]/.test(line)
    );

    if (hasStructuredContent) {
      return [trimmed];
    }

    // 4. 默认按行分割
    return lines.map((line) => line.trim()).filter((line) => line.length > 0);
  };

  // 批量模式下的任务数（用于 UI 显示）
  const safePreviewCountPerPrompt = Math.max(1, Math.min(MAX_BATCH_COUNT_PER_PROMPT, Math.floor(batchConfig.countPerPrompt || 1)));
  const maxBatchPromptCount = Math.max(1, Math.floor(MAX_BATCH_TOTAL / safePreviewCountPerPrompt));
  const batchPromptCount = Math.min(parsePromptsToBatch(prompt).length, maxBatchPromptCount);
  const selectedBatchImages = useMemo(() => {
    if (selectedBatchImageIds.length === 0) return [];
    const idSet = new Set(selectedBatchImageIds);
    return batchTasks
      .flatMap((t) => t.images || [])
      .filter((img) => idSet.has(img.id));
  }, [batchTasks, selectedBatchImageIds]);

  useEffect(() => {
    if (batchTasks.length === 0) {
      setSelectedBatchImageIds([]);
      return;
    }
    const availableIds = new Set(batchTasks.flatMap((t) => t.images || []).map((img) => img.id));
    setSelectedBatchImageIds((prev) => prev.filter((id) => availableIds.has(id)));
  }, [batchTasks]);

  const handleBatchGenerate = async () => {
    if (generateLockRef.current) return;
    if (isGenerating) return;

    let prompts = parsePromptsToBatch(prompt);
    if (prompts.length === 0) return;

    const model = customModel;
    if (!model.trim()) {
      showToast('请先填写模型名', 'error');
      return;
    }
    if (!settings.baseUrl?.trim()) {
      showToast('请先填写 Base URL', 'error');
      return;
    }
    if (!isAntigravityTools && !settings.apiKey?.trim()) {
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
    setSelectedBatchImageIds([]);

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

        const antigravityConfig = isAntigravityTools ? inferAntigravityImageConfigFromModelId(model) : null;
        if (antigravityConfig?.aspectRatio) currentParams.aspectRatio = antigravityConfig.aspectRatio;
        if (antigravityConfig?.imageSize) currentParams.imageSize = antigravityConfig.imageSize;

        const outcomes = await generateImages(currentParams, settings, {
          signal: controller.signal,
          // Antigravity Tools 推荐通过“模型后缀 / size 参数”控制比例与分辨率；这里不再额外传 aspect_ratio/size，避免冲突。
          imageConfig: isAntigravityTools ? {} : undefined,
        });

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
    setSelectedBatchImageIds([]);
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

  const handleBatchDownloadSelected = async () => {
    if (isGenerating) return;
    if (selectedBatchImages.length === 0) return;
    try {
      const n = await downloadImagesSequentially(selectedBatchImages, { delayMs: 140 });
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
    !!prompt.trim() &&
    !!customModel.trim() &&
    !!settings.baseUrl.trim() &&
    (isAntigravityTools || !!settings.apiKey.trim());

  return (
    <div className="aurora-page h-screen pb-0">
       <main className="aurora-canvas-modern relative h-full flex flex-col">
           {/* Header */}
           <div className="aurora-canvas-header py-2 px-4 border-b border-ash bg-graphite/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                 <span className="font-semibold text-sm">生成结果</span>
                 {isBatchMode && (
                    <span className="text-xs text-text-muted ml-2">
                       {batchTasks.filter(t => t.status === 'success').length} / {batchTasks.length} 完成
                    </span>
                 )}
              </div>
              <div className="flex gap-2">
                 {isBatchMode && batchTasks.some(t => t.status==='success') && (
                    <button onClick={() => void handleBatchDownloadAll()} className="text-xs px-2 py-1 rounded border border-ash hover:bg-white/5">
                       下载全部
                    </button>
                 )}
                 <button onClick={handleClearBatch} className="text-xs px-2 py-1 rounded text-text-muted hover:text-text-primary">
                    清空
                 </button>
              </div>
           </div>

           {/* Canvas Body */}
           <div className="aurora-canvas-body-modern scrollbar-thin flex-1 min-h-0 relative">
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
                  slots={generatedSlots}
                  isGenerating={isGenerating}
                  params={params}
                  onImageClick={onImageClick}
                  onEdit={onEdit}
                />
              )}
           </div>
           
           {/* Floating Input */}
           <div className="aurora-floating-container">
             {/* Optimizer Hint */}
             {optimizerConfig?.enabled && (
               <div className="flex items-center justify-between px-2 py-1">
                 <span className="text-[10px] text-banana-500 flex items-center gap-1">
                   <Wand2 className="w-3 h-3" />
                   {optimizerConfig.mode === 'auto' ? '自动优化已启用' : '手动优化模式'}
                 </span>
                 <button 
                   onClick={() => void handleOptimizePrompt()}
                   disabled={isOptimizing || !prompt.trim()}
                   className="text-[10px] text-text-muted hover:text-text-primary underline decoration-dashed"
                 >
                   {isOptimizing ? '优化中...' : '手动优化'}
                 </button>
               </div>
             )}

             {/* Ref Images */}
             {refImages.length > 0 && (
               <div className="aurora-floating-refs">
                 {refImages.map((img, idx) => (
                   <div key={idx} className="aurora-ref-chip group">
                     <img src={img} alt="Ref" />
                     <button onClick={() => removeRefImage(idx)} className="aurora-ref-chip-remove">
                       <X className="w-4 h-4" />
                     </button>
                   </div>
                 ))}
                 <label className="aurora-ref-chip border-dashed flex items-center justify-center cursor-pointer hover:bg-white/5 transition-colors text-text-muted">
                   <Plus className="w-4 h-4" />
                   <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                 </label>
               </div>
             )}

             {/* Input Bar */}
             <div className="aurora-floating-bar group">
               <label className="p-2 cursor-pointer text-text-muted hover:text-text-primary transition-colors" title="添加参考图">
                 <ImageIcon className="w-5 h-5" />
                 <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
               </label>
               
               <textarea
                 value={prompt}
                 onChange={(e) => setPrompt(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && !e.shiftKey) {
                     e.preventDefault();
                     void handleGenerate();
                   }
                 }}
                 placeholder={
                    isBatchMode 
                      ? "批量模式：输入多条提示词..." 
                      : (optimizerConfig?.enabled ? "输入提示词（将自动优化）..." : "输入提示词...")
                 }
                 className="flex-1 bg-transparent border-none outline-none resize-none py-3 text-sm min-h-[44px] max-h-[200px]"
                 rows={1}
               />
               
               <button 
                 onClick={() => {
                   if (isGenerating) handleStop();
                   else void handleGenerate();
                 }}
                 disabled={!isGenerating && !canGenerate}
                 className={`aurora-floating-btn ${
                   isGenerating 
                     ? 'bg-error text-white hover:bg-error/90' 
                     : 'bg-banana-500 text-black hover:bg-banana-400 disabled:opacity-50 disabled:cursor-not-allowed'
                 }`}
               >
                 {isGenerating ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles className="w-4 h-4" />}
               </button>
             </div>
           </div>
       </main>
    </div>
  );
};

