import React, { useEffect, useState } from 'react';
import { HelpCircle, Wand2 } from 'lucide-react';
import { PromptOptimizerConfig } from '../types';
import { getPromptOptimizerConfig, setPromptOptimizerConfig, createDefaultPromptOptimizerConfig } from '../services/db';
import { Tooltip } from './Tooltip';

interface PromptOptimizerSettingsProps {
  /** 配置变化时通知父组件 */
  onConfigChange?: (config: PromptOptimizerConfig | null) => void;
  /** 当前提示词（手动优化时需要） */
  currentPrompt?: string;
  /** 手动优化触发回调 */
  onOptimize?: () => void;
  /** 是否正在优化中 */
  isOptimizing?: boolean;
}

export const PromptOptimizerSettings = ({
  onConfigChange,
  currentPrompt,
  onOptimize,
  isOptimizing = false,
}: PromptOptimizerSettingsProps) => {
  const [config, setConfig] = useState<PromptOptimizerConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 加载配置
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const saved = await getPromptOptimizerConfig();
      if (cancelled) return;
      if (saved) {
        // 兼容旧配置：如果没有 mode 字段，添加默认值
        const normalized = {
          ...saved,
          mode: saved.mode || 'manual',
        } as PromptOptimizerConfig;
        setConfig(normalized);
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

  if (isLoading || !config) {
    return null;
  }

  const canOptimize = config.enabled && config.mode === 'manual' && currentPrompt?.trim() && !isOptimizing;

  return (
    <div className="mt-3 pt-3 border-t border-dark-border">
      {/* 开关按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">MCP 提示词优化</span>
          <Tooltip content={'通过 MCP 服务优化提示词\n需要 prompt-optimizer MCP 服务运行中\n\n手动模式：点击"优化"按钮触发\n自动模式：点击"生成"时自动优化'}>
            <HelpCircle className="w-3.5 h-3.5 text-gray-500 cursor-help" />
          </Tooltip>
        </div>
        <button
          type="button"
          onClick={() => setConfig({ ...config, enabled: !config.enabled, updatedAt: Date.now() })}
          aria-label={config.enabled ? '关闭 MCP 优化' : '开启 MCP 优化'}
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
          {/* 模式选择 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">优化模式</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfig({ ...config, mode: 'manual', updatedAt: Date.now() })}
                className={`flex-1 text-xs py-1.5 px-2 rounded border transition-colors ${
                  config.mode === 'manual'
                    ? 'bg-banana-500/20 border-banana-500 text-banana-400'
                    : 'bg-dark-bg border-dark-border text-gray-400 hover:border-gray-500'
                }`}
              >
                手动
              </button>
              <button
                type="button"
                onClick={() => setConfig({ ...config, mode: 'auto', updatedAt: Date.now() })}
                className={`flex-1 text-xs py-1.5 px-2 rounded border transition-colors ${
                  config.mode === 'auto'
                    ? 'bg-banana-500/20 border-banana-500 text-banana-400'
                    : 'bg-dark-bg border-dark-border text-gray-400 hover:border-gray-500'
                }`}
              >
                自动
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              {config.mode === 'manual'
                ? '点击下方"优化"按钮手动触发'
                : '点击"生成"时自动优化提示词'}
            </p>
          </div>

          {/* 手动模式下的优化按钮 */}
          {config.mode === 'manual' && (
            <button
              type="button"
              onClick={onOptimize}
              disabled={!canOptimize}
              className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                canOptimize
                  ? 'bg-gradient-to-r from-banana-500 to-banana-400 text-black hover:from-banana-400 hover:to-banana-300'
                  : 'bg-dark-border text-gray-500 cursor-not-allowed'
              }`}
            >
              <Wand2 className={`w-4 h-4 ${isOptimizing ? 'animate-pulse' : ''}`} />
              {isOptimizing ? '优化中...' : '优化提示词'}
            </button>
          )}
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
      if (saved) {
        // 兼容旧配置
        const normalized = {
          ...saved,
          mode: saved.mode || 'manual',
        } as PromptOptimizerConfig;
        setConfig(normalized);
      }
      setIsLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return { config, isLoading };
};
