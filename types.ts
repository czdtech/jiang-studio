/** Gemini 官方设置 */
export interface GeminiSettings {
  apiKey: string;
  baseUrl?: string;
}

/** OpenAI 兼容设置 */
export interface OpenAISettings {
  apiKey: string;
  baseUrl: string;
}

export enum ModelType {
  NANO_BANANA_PRO = 'gemini-3-pro-image-preview',
  NANO_BANANA = 'gemini-2.5-flash-image',
  CUSTOM = 'custom', // 用于输入任意模型 ID（OpenAI 兼容 / 其他非枚举后端）
}

// Gemini 官方模型预设
export const MODEL_PRESETS = [
  { value: ModelType.NANO_BANANA_PRO, label: 'Nano Banana Pro', desc: 'gemini-3-pro-image-preview' },
  { value: ModelType.NANO_BANANA, label: 'Nano Banana', desc: 'gemini-2.5-flash-image' },
] as const;

export interface GenerationParams {
  prompt: string;
  negativePrompt?: string; // Not strictly supported by all Gemini models yet, but good for UI
  aspectRatio: '1:1' | '2:3' | '3:2' | '4:3' | '3:4' | '4:5' | '5:4' | '16:9' | '9:16' | '21:9' | 'auto';
  imageSize: '1K' | '2K' | '4K'; // Only for Pro
  outputFormat?: 'png' | 'jpg';
  count: number; // 1-4
  model: ModelType;
  referenceImages?: string[]; // Array of Base64 strings
}

export interface GeneratedImage {
  id: string;
  base64: string;
  /** 生成来源（用于编辑时选择正确的后端/供应商） */
  sourceScope?: ProviderScope;
  /** 生成时使用的供应商 ID（用于编辑/重试时复用同一供应商配置） */
  sourceProviderId?: string;
  /**
   * 可选：如果启用“落盘存储”，这里会保存文件句柄；base64 可能是缩略图而非原图。
   * 注意：File System Access API 仅在部分浏览器/安全上下文可用。
   */
  fileHandle?: FileSystemFileHandle;
  fileName?: string;
  storage?: 'idb' | 'fs';
  prompt: string;
  model: string;
  timestamp: number;
  params: GenerationParams;
}

export type ProviderScope = 'gemini' | 'openai_proxy' | 'antigravity_tools' | 'kie';

export interface ProviderModelsCache {
  all: string[];
  image: string[];
  text?: string[];
  fetchedAt: number;
  lastError?: string;
}

export interface ProviderProfile {
  id: string;
  scope: ProviderScope;
  name: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  favorite?: boolean;
  createdAt: number;
  updatedAt: number;
  modelsCache?: ProviderModelsCache;
}

export interface ProviderDraft {
  scope: ProviderScope;
  providerId: string;
  prompt: string;
  params: GenerationParams;
  refImages: string[];
  model: string;
  updatedAt: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text?: string;
  image?: string;
}

/** Prompt 优化器配置（MCP 模式） */
export interface PromptOptimizerConfig {
  enabled: boolean; // 是否启用优化器
  mode: 'manual' | 'auto'; // 手动模式：点优化按钮触发；自动模式：点生成时自动优化
  templateId: string; // 优化器模板 ID
  iterateTemplateId: string; // 迭代助手模板 ID
  updatedAt: number;
}

/** 迭代助手消息 */
export interface IterationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** 批量任务状态 */
export type BatchTaskStatus = 'pending' | 'running' | 'success' | 'error';

/** 批量任务项 */
export interface BatchTask {
  id: string;
  prompt: string;
  status: BatchTaskStatus;
  images?: GeneratedImage[];
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/** 批量生成配置 */
export interface BatchConfig {
  concurrency: number; // 并发数，默认 2
  countPerPrompt: number; // 每个提示词生成几张，默认 1
}

export type ImageGenerationOutcome =
  | { ok: true; image: GeneratedImage }
  | { ok: false; error: string };
