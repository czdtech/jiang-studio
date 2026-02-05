import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { GenerationParams, PromptOptimizerConfig, BatchConfig, ProviderScope } from '../types';
import { getSetting, setSetting, getPromptOptimizerConfig, setPromptOptimizerConfig as saveOptimizerConfig } from '../services/db';

interface GenerationSettingsContextType {
  // 供应商与模型
  activeProviderId: string;
  setActiveProviderId: (id: string, scope: ProviderScope) => void;
  customModel: string;
  setCustomModel: (model: string) => void;
  
  // 生成参数
  params: GenerationParams;
  setParams: (params: GenerationParams) => void;
  updateParams: (updates: Partial<GenerationParams>) => void;
  
  // 提示词优化器
  optimizerConfig: PromptOptimizerConfig;
  setOptimizerConfig: (config: PromptOptimizerConfig) => void;
  
  // 批量任务
  batchConfig: BatchConfig;
  setBatchConfig: (config: BatchConfig) => void;

  // 状态加载
  isLoadingSettings: boolean;
}

const DEFAULT_PARAMS: GenerationParams = {
  prompt: '',
  aspectRatio: '1:1',
  imageSize: '1K',
  count: 1,
  model: 'dall-e-3' as any,
  referenceImages: [],
};

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  concurrency: 2,
  countPerPrompt: 1,
};

const DEFAULT_OPTIMIZER_CONFIG: PromptOptimizerConfig = {
  enabled: true,
  mode: 'manual',
  templateId: 'image-general-optimize',
  iterateTemplateId: 'image-iterate-general',
  updatedAt: Date.now(),
};

const GenerationSettingsContext = createContext<GenerationSettingsContextType | undefined>(undefined);

export const GenerationSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeProviderId, setActiveProviderIdState] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);
  const [optimizerConfig, setOptimizerConfigState] = useState<PromptOptimizerConfig>(DEFAULT_OPTIMIZER_CONFIG);
  const [batchConfig, setBatchConfig] = useState<BatchConfig>(DEFAULT_BATCH_CONFIG);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // 初始化加载
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // 并行加载各项配置
        const [
          savedParams,
          savedBatchConfig,
          savedOptimizerConfig,
          savedModel
        ] = await Promise.all([
          getSetting<GenerationParams>('lastGenerationParams'),
          getSetting<BatchConfig>('lastBatchConfig'),
          getPromptOptimizerConfig(),
          getSetting<string>('lastCustomModel'),
        ]);

        if (savedParams) setParams({ ...DEFAULT_PARAMS, ...savedParams });
        if (savedBatchConfig) setBatchConfig(savedBatchConfig);
        if (savedOptimizerConfig) setOptimizerConfigState(savedOptimizerConfig);
        if (savedModel) setCustomModel(savedModel);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setIsLoadingSettings(false);
      }
    };

    loadSettings();
  }, []);

  // 持久化监听
  const setActiveProviderId = (id: string, scope: ProviderScope) => {
    setActiveProviderIdState(id);
    // 这里也可以选择持久化 activeProviderId，但在 db.ts 里已经有 setActiveProviderId 方法了
    // 页面层级通常会直接调 db 的方法，这里 Context 主要做内存状态提升
  };

  const updateParams = (updates: Partial<GenerationParams>) => {
    setParams(prev => {
      const next = { ...prev, ...updates };
      setSetting('lastGenerationParams', next).catch(console.error);
      return next;
    });
  };

  const handleSetCustomModel = (model: string) => {
    setCustomModel(model);
    setSetting('lastCustomModel', model).catch(console.error);
  };

  const handleSetBatchConfig = (config: BatchConfig) => {
    setBatchConfig(config);
    setSetting('lastBatchConfig', config).catch(console.error);
  };

  const handleSetOptimizerConfig = (config: PromptOptimizerConfig) => {
    setOptimizerConfigState(config);
    saveOptimizerConfig(config).catch(console.error);
  };

  return (
    <GenerationSettingsContext.Provider
      value={{
        activeProviderId,
        setActiveProviderId,
        customModel,
        setCustomModel: handleSetCustomModel,
        params,
        setParams,
        updateParams,
        optimizerConfig,
        setOptimizerConfig: handleSetOptimizerConfig,
        batchConfig,
        setBatchConfig: handleSetBatchConfig,
        isLoadingSettings,
      }}
    >
      {children}
    </GenerationSettingsContext.Provider>
  );
};

export const useGenerationSettings = () => {
  const context = useContext(GenerationSettingsContext);
  if (!context) {
    throw new Error('useGenerationSettings must be used within a GenerationSettingsProvider');
  }
  return context;
};
