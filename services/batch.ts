/**
 * 批量生成服务
 * 提供提示词解析、并发控制等通用逻辑
 */
import { BatchTask, BatchTaskStatus, GeneratedImage, ImageGenerationOutcome, BatchConfig, ProviderScope } from '../types';
import { runWithConcurrency } from './shared';

export const MAX_BATCH_TOTAL = 32;
export const MAX_BATCH_CONCURRENCY = 8;
export const MAX_BATCH_COUNT_PER_PROMPT = 4;

/**
 * 解析提示词为批量任务
 * 
 * 仅在用户显式使用 `---` 分隔符时才拆分为多个提示词。
 * 普通换行始终视为单个提示词的一部分，避免优化后的多行提示词被误拆。
 */
export const parsePromptsToBatch = (text: string): string[] => {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // 仅当显式使用 --- 分隔符时才拆分为批量任务
  if (trimmed.includes('\n---\n') || trimmed.includes('\n---')) {
    return trimmed
      .split(/\n-{3,}\n?/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // 其他情况一律视为单个提示词
  return [trimmed];
};

/**
 * 执行批量任务
 */
export const executeBatch = async (
  tasks: BatchTask[],
  batchConfig: BatchConfig,
  generateFn: (task: BatchTask) => Promise<ImageGenerationOutcome[]>,
  onTaskUpdate: (task: BatchTask) => void,
  checkAborted: () => boolean
): Promise<{ successCount: number; results: GeneratedImage[] }> => {
  const safeConcurrency = Math.max(1, Math.min(MAX_BATCH_CONCURRENCY, Math.floor(batchConfig.concurrency || 1)));
  let successCount = 0;
  const allResults: GeneratedImage[] = [];

  const runTask = async (task: BatchTask): Promise<void> => {
    if (checkAborted()) {
      onTaskUpdate({
        ...task,
        status: 'error',
        error: '已取消',
        completedAt: Date.now(),
      });
      return;
    }

    // 更新状态为运行中
    const runningTask = { ...task, status: 'running' as BatchTaskStatus, startedAt: Date.now() };
    onTaskUpdate(runningTask);

    try {
      const outcomes = await generateFn(runningTask);

      if (checkAborted()) {
        onTaskUpdate({
          ...runningTask,
          status: 'error',
          error: '已取消',
          completedAt: Date.now(),
        });
        return;
      }

      const successImages = outcomes
        .filter((o): o is { ok: true; image: GeneratedImage } => o.ok === true)
        .map((o) => o.image);

      const failErrors = outcomes
        .filter((o): o is { ok: false; error: string } => o.ok === false)
        .map((o) => o.error);

      if (successImages.length > 0) {
        successCount++;
        allResults.push(...successImages);
        onTaskUpdate({
          ...runningTask,
          status: 'success',
          images: successImages,
          error: failErrors.length > 0 ? `部分失败：${failErrors[0]}` : undefined,
          completedAt: Date.now(),
        });
      } else {
        // 全部失败
        const isAborted = failErrors.some(e => e === '已停止' || e === '已取消');
        if (isAborted || checkAborted()) {
             onTaskUpdate({
            ...runningTask,
            status: 'error',
            error: '已取消',
            completedAt: Date.now(),
          });
        } else {
            onTaskUpdate({
            ...runningTask,
            status: 'error',
            error: failErrors[0] || '生成失败',
            completedAt: Date.now(),
          });
        }
      }
    } catch (e) {
      if (checkAborted()) {
        onTaskUpdate({
            ...runningTask,
            status: 'error',
            error: '已取消',
            completedAt: Date.now(),
          });
      } else {
        onTaskUpdate({
            ...runningTask,
            status: 'error',
            error: e instanceof Error ? e.message : '未知错误',
            completedAt: Date.now(),
          });
      }
    }
  };

  // 使用并发控制执行任务
  const taskExecutors = tasks.map(task => () => runTask(task));
  await runWithConcurrency(taskExecutors, safeConcurrency, undefined); // signal handles internally in runTask via checkAborted

  return { successCount, results: allResults };
};

/**
 * 验证批量参数
 */
export const validateBatchParams = (
    prompts: string[],
    config: BatchConfig,
    showToast: (msg: string, type: 'info' | 'error' | 'success') => void
): string[] => {
    const safeCountPerPrompt = Math.max(1, Math.min(MAX_BATCH_COUNT_PER_PROMPT, Math.floor(config.countPerPrompt || 1)));
    const maxPromptCount = Math.max(1, Math.floor(MAX_BATCH_TOTAL / safeCountPerPrompt));

    if (prompts.length > maxPromptCount) {
        showToast(`批量模式一次最多生成 ${MAX_BATCH_TOTAL} 张，已截取前 ${maxPromptCount} 条提示词`, 'info');
        return prompts.slice(0, maxPromptCount);
    }
    return prompts;
}
