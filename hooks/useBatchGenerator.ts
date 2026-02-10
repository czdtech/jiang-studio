import React, { useState, useRef, useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import {
    BatchTask,
    BatchConfig,
    GeneratedImage,
    GenerationParams,
    ImageGenerationOutcome,
    BatchTaskStatus,
    ProviderScope,
    PromptOptimizerConfig
} from '../types';
import {
    parsePromptsToBatch,
    executeBatch,
    validateBatchParams,
    MAX_BATCH_COUNT_PER_PROMPT
} from '../services/batch';
import { downloadImagesSequentially } from '../services/download';
import { optimizeUserPrompt } from '../services/mcp';

interface UseBatchGeneratorProps {
    showToast: (msg: string, type: 'info' | 'error' | 'success') => void;
    saveImage: (image: GeneratedImage) => Promise<void>;
    scope: ProviderScope;
    activeProviderId: string;
}

interface UseBatchGeneratorResult {
    // State
    batchTasks: BatchTask[];
    isBatchMode: boolean;
    batchConfig: BatchConfig;
    selectedBatchImageIds: string[];
    isGenerating: boolean;

    // Actions
    setBatchConfig: Dispatch<SetStateAction<BatchConfig>>;
    setBatchTasks: Dispatch<SetStateAction<BatchTask[]>>;
    setSelectedBatchImageIds: Dispatch<SetStateAction<string[]>>;
    setIsBatchMode: Dispatch<SetStateAction<boolean>>;
    startBatch: (
        prompt: string,
        baseParams: GenerationParams,
        generateFn: (params: GenerationParams, abortSignal: AbortSignal) => Promise<ImageGenerationOutcome[]>,
        optimizerConfig: PromptOptimizerConfig | null
    ) => Promise<void>;
    stopBatch: () => void;
    clearBatch: () => void;
    downloadAll: () => Promise<void>;
    downloadSelected: () => Promise<void>;

    // Helpers
    safePreviewCountPerPrompt: number;
}

export const useBatchGenerator = ({
    showToast,
    saveImage,
    scope,
    activeProviderId
}: UseBatchGeneratorProps): UseBatchGeneratorResult => {
    const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
    const [isBatchMode, setIsBatchMode] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [batchConfig, setBatchConfig] = useState<BatchConfig>({ concurrency: 1, countPerPrompt: 1 });
    const [selectedBatchImageIds, setSelectedBatchImageIds] = useState<string[]>([]);

    const batchAbortControllerRef = useRef<AbortController | null>(null);
    const batchAbortRef = useRef(false);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            try {
                batchAbortControllerRef.current?.abort();
            } catch {}
        };
    }, []);

    const safePreviewCountPerPrompt = Math.max(1, Math.min(MAX_BATCH_COUNT_PER_PROMPT, Math.floor(batchConfig.countPerPrompt || 1)));

    const startBatch = useCallback(async (
        prompt: string,
        baseParams: GenerationParams,
        generateFn: (params: GenerationParams, abortSignal: AbortSignal) => Promise<ImageGenerationOutcome[]>,
        optimizerConfig: PromptOptimizerConfig | null
    ) => {
        if (isGenerating) return;

        let prompts = parsePromptsToBatch(prompt);
        if (prompts.length === 0) return;

        prompts = validateBatchParams(prompts, batchConfig, showToast);

        // Initialize tasks
        const tasks: BatchTask[] = prompts.map(p => ({
            id: crypto.randomUUID(),
            prompt: p,
            status: 'pending' as BatchTaskStatus,
        }));

        const controller = new AbortController();
        batchAbortControllerRef.current = controller;
        batchAbortRef.current = false;

        setBatchTasks(tasks);
        setIsBatchMode(true);
        setIsGenerating(true);
        setSelectedBatchImageIds([]);

        const safeCountPerPrompt = Math.max(1, Math.min(MAX_BATCH_COUNT_PER_PROMPT, Math.floor(batchConfig.countPerPrompt || 1)));

        try {
            const { successCount } = await executeBatch(
                tasks,
                batchConfig,
                async (task) => {
                    // Optimize prompt if needed
                    let finalPrompt = task.prompt;
                    if (optimizerConfig?.enabled && optimizerConfig.mode === 'auto') {
                        try {
                            finalPrompt = await optimizeUserPrompt(task.prompt, optimizerConfig.templateId);
                        } catch {
                            // ignore optimization error
                        }
                    }

                    const currentParams: GenerationParams = {
                        ...baseParams,
                        prompt: finalPrompt,
                        count: safeCountPerPrompt
                    };

                    const outcomes = await generateFn(currentParams, controller.signal);

                    // Post-process success images (add scope, save)
                    const successImages = outcomes
                        .filter((o): o is { ok: true; image: GeneratedImage } => o.ok === true)
                        .map(o => ({
                            ...o.image,
                            sourceScope: scope,
                            sourceProviderId: activeProviderId
                        }));

                    for (const img of successImages) {
                        if (batchAbortRef.current || controller.signal.aborted) break;
                        await saveImage(img);
                    }

                    // Map back to outcomes with processed images
                    return outcomes.map(o => {
                        if (o.ok && successImages.find(img => img.id === o.image.id)) {
                             return { ok: true, image: successImages.find(img => img.id === o.image.id)! };
                        }
                        return o;
                    });
                },
                (updatedTask) => {
                    setBatchTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
                },
                () => batchAbortRef.current || controller.signal.aborted
            );

            if (batchAbortRef.current || controller.signal.aborted) {
                const now = Date.now();
                setBatchTasks(prev => prev.map(t =>
                    t.status === 'pending' ? { ...t, status: 'error' as BatchTaskStatus, error: '已取消', completedAt: now } : t
                ));
                showToast('批量生成已停止', 'info');
            } else {
                showToast(`批量完成：${successCount}/${tasks.length} 成功`, successCount === tasks.length ? 'success' : 'info');
            }

        } finally {
            setIsGenerating(false);
            batchAbortControllerRef.current = null;
        }
    }, [isGenerating, batchConfig, scope, activeProviderId, saveImage, showToast]);

    const stopBatch = useCallback(() => {
        if (!isGenerating) return;
        batchAbortRef.current = true;
        try {
            batchAbortControllerRef.current?.abort();
        } catch {}

        const now = Date.now();
        setBatchTasks(prev => prev.map(t =>
            t.status === 'pending' ? { ...t, status: 'error' as BatchTaskStatus, error: '已取消', completedAt: now } : t
        ));
    }, [isGenerating]);

    const clearBatch = useCallback(() => {
        setBatchTasks([]);
        setIsBatchMode(false);
        setSelectedBatchImageIds([]);
    }, []);

    const selectedBatchImages = useMemo(() => {
        if (selectedBatchImageIds.length === 0) return [];
        const idSet = new Set(selectedBatchImageIds);
        return batchTasks
            .flatMap((t) => t.images || [])
            .filter((img) => idSet.has(img.id));
    }, [batchTasks, selectedBatchImageIds]);

    const downloadAll = useCallback(async () => {
        if (isGenerating) return;
        const images = batchTasks.flatMap((t) => t.images || []);
        if (images.length === 0) return;

        try {
            const n = await downloadImagesSequentially(images, { delayMs: 140 });
            showToast(`已开始下载 ${n} 张`, 'success');
        } catch (e) {
            showToast('批量下载失败：' + (e instanceof Error ? e.message : '未知错误'), 'error');
        }
    }, [isGenerating, batchTasks, showToast]);

    const downloadSelected = useCallback(async () => {
        if (isGenerating) return;
        if (selectedBatchImages.length === 0) return;
        try {
            const n = await downloadImagesSequentially(selectedBatchImages, { delayMs: 140 });
            showToast(`已开始下载 ${n} 张`, 'success');
        } catch (e) {
            showToast('批量下载失败：' + (e instanceof Error ? e.message : '未知错误'), 'error');
        }
    }, [isGenerating, selectedBatchImages, showToast]);

    // Keep selected IDs in sync with available images
    useEffect(() => {
        if (batchTasks.length === 0) {
            setSelectedBatchImageIds([]);
            return;
        }
        const availableIds = new Set(batchTasks.flatMap((t) => t.images || []).map((img) => img.id));
        setSelectedBatchImageIds((prev) => prev.filter((id) => availableIds.has(id)));
    }, [batchTasks]);

    return {
        batchTasks,
        isBatchMode,
        batchConfig,
        selectedBatchImageIds,
        isGenerating,
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
    };
};
