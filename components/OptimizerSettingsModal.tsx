import React from 'react';
import { X } from 'lucide-react';
import { PromptOptimizerSettings } from './PromptOptimizerSettings';
import { PromptOptimizerConfig } from '../types';

interface OptimizerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChange?: (config: PromptOptimizerConfig | null) => void;
}

export const OptimizerSettingsModal: React.FC<OptimizerSettingsModalProps> = ({
  isOpen,
  onClose,
  onConfigChange,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-dark-surface rounded-xl border border-dark-border shadow-2xl w-[420px] max-w-[90vw] max-h-[80vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-border">
          <h3 className="text-base font-bold text-white">提示词增强配置</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-xs text-gray-400 mb-4">
            配置独立的 API 用于“提示词增强”，可以用更便宜的文本模型来增强提示词。
            关闭时将使用当前页面的供应商配置。
          </p>

          {/* Reuse existing PromptOptimizerSettings component */}
          <div className="[&>div]:mt-0 [&>div]:pt-0 [&>div]:border-t-0">
            <PromptOptimizerSettings onConfigChange={onConfigChange} />
          </div>
        </div>
      </div>
    </div>
  );
};
