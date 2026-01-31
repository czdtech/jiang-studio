import React, { useEffect, useState } from 'react';
import { HelpCircle, RefreshCw } from 'lucide-react';
import { PromptOptimizerConfig } from '../types';
import { getPromptOptimizerConfig, setPromptOptimizerConfig, createDefaultPromptOptimizerConfig } from '../services/db';
import { Tooltip } from './Tooltip';

interface PromptOptimizerSettingsProps {
  /** 配置变化时通知父组件 */
  onConfigChange?: (config: PromptOptimizerConfig | null) => void;
}

export const PromptOptimizerSettings = ({
  onConfigChange,
}: PromptOptimizerSettingsProps) => {
  const [config, setConfig] = useState<PromptOptimizerConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [modelsHint, setModelsHint] = useState('');

  // 加载配置
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const saved = await getPromptOptimizerConfig();
      if (cancelled) return;
      if (saved) {
        setConfig(saved);
      } else {
        const def = createDefaultPromptOptimizerConfig();
        setConfig(def);
      }
      setIsLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // 持久化配置
  useEffect(() => {
    if (!config || isLoading) return;
    const t = window.setTimeout(() => {
      void setPromptOptimizerConfig(config);
      onConfigChange?.(config.enabled ? config : null);
    }, 300);
    return () => window.clearTimeout(t);
  }, [config, isLoading, onConfigChange]);

  const handleRefreshModels = async () => {
    if (!config?.baseUrl) return;
    setIsRefreshingModels(true);
    setModelsHint('');
    try {
      const cleanBaseUrl = config.baseUrl.replace(/\/$/, '');
      const url = `${cleanBaseUrl}/v1/models`;
      
      const headers: Record<string, string> = {};
      if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
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
      
      // 筛选文本模型
      const textKeywords = ['gpt', 'claude', 'gemini', 'llama', 'mistral', 'qwen', 'deepseek', 'chat', 'turbo'];
      const excludeKeywords = ['image', 'vision', 'dall-e', 'stable-diffusion', 'embedding', 'whisper', 'tts'];
      
      const textModels = ids.filter((id) => {
        const s = id.toLowerCase();
        const hasText = textKeywords.some((k) => s.includes(k));
        const isExcluded = excludeKeywords.some((k) => s.includes(k));
        return hasText && !isExcluded;
      }).sort();
      
      setCustomModels(textModels);
      setModelsHint(`已刷新，找到 ${textModels.length} 个文本模型`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown';
      setModelsHint(`刷新失败：${msg}`);
    } finally {
      setIsRefreshingModels(false);
    }
  };

  if (isLoading || !config) {
    return null;
  }

  // 独立配置只显示从独立 API 刷新的模型（customModels）

  return (
    <div className="mt-3 pt-3 border-t border-dark-border">
      {/* 开关按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">自定义提示词增强模型</span>
          <Tooltip content="独立配置“提示词增强”使用的 API&#10;可以用更便宜的文本模型来增强提示词&#10;&#10;关闭时将使用当前页面的供应商配置">
            <HelpCircle className="w-3.5 h-3.5 text-gray-500 cursor-help" />
          </Tooltip>
        </div>
        <button
          type="button"
          onClick={() => setConfig({ ...config, enabled: !config.enabled, updatedAt: Date.now() })}
          aria-label={config.enabled ? '关闭提示词增强配置' : '开启提示词增强配置'}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            config.enabled ? 'bg-banana-500' : 'bg-dark-border'
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              config.enabled ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {/* 配置内容（开关打开时显示） */}
      {config.enabled && (
        <div className="mt-3 space-y-3">
          {/* API Key */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value, updatedAt: Date.now() })}
              placeholder="sk-xxxx"
              className="w-full text-xs bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-white placeholder-gray-500"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Base URL</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => {
                setConfig({ ...config, baseUrl: e.target.value, updatedAt: Date.now() });
                setCustomModels([]);
                setModelsHint('');
              }}
              placeholder="https://api.openai.com"
              className="w-full text-xs bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-white placeholder-gray-500"
            />
          </div>

          {/* Model */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">优化模型</label>
              <button
                onClick={() => void handleRefreshModels()}
                disabled={isRefreshingModels || !config.baseUrl}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
            <input
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value, updatedAt: Date.now() })}
              placeholder="gpt-4o-mini, claude-3-haiku..."
              className="w-full text-xs bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-white placeholder-gray-500"
            />
            
            {customModels.length > 0 && (
              <div className="relative mt-1.5">
                <select
                  value={customModels.includes(config.model) ? config.model : ''}
                  onChange={(e) => setConfig({ ...config, model: e.target.value, updatedAt: Date.now() })}
                  className="w-full text-xs bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-white"
                >
                  <option value="" disabled>从已刷新的模型中选择...</option>
                  {customModels.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </div>
            )}
            
            {modelsHint && (
              <p className={`text-xs mt-1 ${modelsHint.includes('失败') ? 'text-yellow-500/80' : 'text-gray-500'}`}>
                {modelsHint}
              </p>
            )}
          </div>

          <p className="text-xs text-gray-500">
            推荐使用便宜的文本模型，如 gpt-4o-mini、claude-3-haiku、deepseek-chat 等
          </p>
        </div>
      )}
    </div>
  );
};

/** Hook: 获取当前有效的优化器配置 */
export const usePromptOptimizerConfig = () => {
  const [config, setConfig] = useState<PromptOptimizerConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const saved = await getPromptOptimizerConfig();
      if (cancelled) return;
      setConfig(saved);
      setIsLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return { config, isLoading };
};
