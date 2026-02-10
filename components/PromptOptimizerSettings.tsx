import React, { useEffect, useState } from 'react';
import { HelpCircle, Wand2 } from 'lucide-react';
import { PromptOptimizerConfig } from '../types';
import { getPromptOptimizerConfig, setPromptOptimizerConfig, createDefaultPromptOptimizerConfig } from '../services/db';
import { Tooltip } from './Tooltip';

/** 模板分类 */
type TemplateCategory = 'text2image' | 'image2image';

/** 优化模板选项（按分类） */
const TEXT2IMAGE_TEMPLATES = [
  { value: 'image-general-optimize', label: '通用自然语言', desc: '围绕主体/动作/环境/光线/配色/材质/氛围进行层次化叙述' },
  { value: 'image-chinese-optimize', label: '中文美学', desc: '中文语境与传统美学，融入意境、留白、水墨工笔等风格' },
  { value: 'image-creative-text2image', label: '创意解构', desc: '深度解构原始文本，创造前所未见的奇幻视觉叙事' },
  { value: 'image-photography-optimize', label: '摄影向', desc: '强调主体、构图、光线与氛围，适合摄影风格生成' },
  { value: 'image-json-structured-optimize', label: 'JSON 结构化', desc: '输出严格 JSON 格式，结构通用可自由扩展' },
];

const IMAGE2IMAGE_TEMPLATES = [
  { value: 'image2image-general-optimize', label: '通用编辑', desc: '识别添加/删除/替换/增强意图，克制而自然的编辑指导' },
  { value: 'image2image-design-text-edit-optimize', label: '设计文案替换', desc: '保持配色、字体、版式不变，仅替换文案内容' },
  { value: 'image2image-json-structured-optimize', label: 'JSON 结构化', desc: '输出严格 JSON 格式，附带"保留/改变"指导' },
];

const ALL_TEMPLATE_VALUES = new Set([
  ...TEXT2IMAGE_TEMPLATES.map(t => t.value),
  ...IMAGE2IMAGE_TEMPLATES.map(t => t.value),
]);

/** 根据 templateId 推断所属分类 */
const inferCategory = (templateId: string): TemplateCategory => {
  if (IMAGE2IMAGE_TEMPLATES.some(t => t.value === templateId)) return 'image2image';
  return 'text2image';
};

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
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory>('text2image');

  // 加载配置
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const saved = await getPromptOptimizerConfig();
      if (cancelled) return;
      if (saved) {
        // 兼容旧配置：如果没有某些字段，添加默认值
        const normalized: PromptOptimizerConfig = {
          enabled: saved.enabled ?? true,
          mode: saved.mode || 'manual',
          templateId: saved.templateId || 'image-general-optimize',
          updatedAt: saved.updatedAt || Date.now(),
        };
        setConfig(normalized);
        // 根据已保存的模板推断分类
        setTemplateCategory(inferCategory(normalized.templateId));
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

          {/* 模板分类切换 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">优化模板</label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => {
                  setTemplateCategory('text2image');
                  // 切换分类时，自动选中该分类的第一个模板
                  const firstTemplate = TEXT2IMAGE_TEMPLATES[0].value;
                  setConfig({ ...config, templateId: firstTemplate, updatedAt: Date.now() });
                }}
                className={`flex-1 text-xs py-1.5 px-2 rounded border transition-colors ${
                  templateCategory === 'text2image'
                    ? 'bg-banana-500/20 border-banana-500 text-banana-400'
                    : 'bg-dark-bg border-dark-border text-gray-400 hover:border-gray-500'
                }`}
              >
                文生图
              </button>
              <button
                type="button"
                onClick={() => {
                  setTemplateCategory('image2image');
                  const firstTemplate = IMAGE2IMAGE_TEMPLATES[0].value;
                  setConfig({ ...config, templateId: firstTemplate, updatedAt: Date.now() });
                }}
                className={`flex-1 text-xs py-1.5 px-2 rounded border transition-colors ${
                  templateCategory === 'image2image'
                    ? 'bg-banana-500/20 border-banana-500 text-banana-400'
                    : 'bg-dark-bg border-dark-border text-gray-400 hover:border-gray-500'
                }`}
              >
                图生图
              </button>
            </div>
            {/* 当前分类的模板列表 */}
            {(() => {
              const templates = templateCategory === 'text2image' ? TEXT2IMAGE_TEMPLATES : IMAGE2IMAGE_TEMPLATES;
              const currentTemplate = templates.find(t => t.value === config.templateId);
              return (
                <>
                  <select
                    value={currentTemplate ? config.templateId : templates[0].value}
                    onChange={(e) => setConfig({ ...config, templateId: e.target.value, updatedAt: Date.now() })}
                    className="w-full text-sm bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-banana-500"
                  >
                    {templates.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  {currentTemplate && <p className="text-xs text-gray-500 mt-1">{currentTemplate.desc}</p>}
                </>
              );
            })()}
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
        const normalized: PromptOptimizerConfig = {
          enabled: saved.enabled ?? true,
          mode: saved.mode || 'manual',
          templateId: saved.templateId || 'image-general-optimize',
          updatedAt: saved.updatedAt || Date.now(),
        };
        setConfig(normalized);
      }
      setIsLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return { config, isLoading };
};
