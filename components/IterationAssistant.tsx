import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { IterationMessage } from '../types';
import { iteratePrompt } from '../services/mcp';

/** 迭代模板选项 */
const ITERATE_TEMPLATES = [
  { value: 'image-iterate-general', label: '图像迭代', desc: '基于上一次优化结果进行小步可控的图像提示词迭代' },
];

interface IterationAssistantProps {
  /** 当前主提示词 */
  currentPrompt: string;
  /** 用户选择使用某个版本时的回调 */
  onUseVersion: (prompt: string) => void;
  /** 迭代模板 ID */
  iterateTemplateId?: string;
  /** 模板变更回调 */
  onTemplateChange?: (templateId: string) => void;
}

export const IterationAssistant = ({
  currentPrompt,
  onUseVersion,
  iterateTemplateId = 'image-iterate-general',
  onTemplateChange,
}: IterationAssistantProps) => {
  const [messages, setMessages] = useState<IterationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [width, setWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [showTemplateSelect, setShowTemplateSelect] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentTemplate = ITERATE_TEMPLATES.find(t => t.value === iterateTemplateId) || ITERATE_TEMPLATES[0];

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 处理拖拽调整宽度
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const updateWidth = (clientX: number) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - clientX;
      setWidth(Math.max(280, Math.min(600, newWidth)));
    };

    const handleMouseMove = (e: MouseEvent) => {
      updateWidth(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const t = e.touches?.[0];
      if (!t) return;
      updateWidth(t.clientX);
      e.preventDefault();
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleMouseUp);
    document.addEventListener('touchcancel', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleMouseUp);
      document.removeEventListener('touchcancel', handleMouseUp);
    };
  }, [isResizing]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: IterationMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // 使用当前提示词或最后一个 AI 回复作为基础
      const basePrompt = messages.length > 0
        ? messages.filter((m) => m.role === 'assistant').pop()?.content || currentPrompt
        : currentPrompt;

      const result = await iteratePrompt(basePrompt, userMessage.content, iterateTemplateId);

      const assistantMessage: IterationMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: IterationMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `优化失败：${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ width }}
      className="h-full flex flex-col border-l border-dark-border bg-dark-surface/80 backdrop-blur-sm relative"
    >
      {/* 拖拽手柄 */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{ touchAction: 'none' }}
        className={`absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-banana-500/50 transition-colors ${
          isResizing ? 'bg-banana-500' : ''
        }`}
      />

      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-border">
        <MessageCircle className="w-4 h-4 text-banana-400" />
        <span className="text-sm font-medium text-gray-200">迭代助手</span>
      </div>

      {/* 模板选择区域 */}
      <div className="border-b border-dark-border">
        <button
          type="button"
          onClick={() => setShowTemplateSelect(!showTemplateSelect)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-400 hover:text-gray-300 transition-colors"
        >
          <span>模板：{currentTemplate.label}</span>
          {showTemplateSelect ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
        {showTemplateSelect && (
          <div className="px-3 pb-3 space-y-1.5">
            {ITERATE_TEMPLATES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  onTemplateChange?.(t.value);
                  setShowTemplateSelect(false);
                }}
                className={`w-full text-left p-2 rounded border transition-colors ${
                  iterateTemplateId === t.value
                    ? 'bg-banana-500/20 border-banana-500'
                    : 'bg-dark-bg border-dark-border hover:border-gray-500'
                }`}
              >
                <div className={`text-xs font-medium ${iterateTemplateId === t.value ? 'text-banana-400' : 'text-gray-200'}`}>
                  {t.label}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 对话区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            <p>输入你的需求来迭代优化提示词</p>
            <p className="mt-2 text-xs">例如："让画面更温暖"、"添加一只小猫"</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-banana-500/20 text-banana-100'
                  : 'bg-dark-bg border border-dark-border text-gray-200'
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            </div>

            {/* AI 回复下的"使用此版本"按钮 */}
            {msg.role === 'assistant' && !msg.content.startsWith('优化失败') && (
              <button
                onClick={() => onUseVersion(msg.content)}
                className="mt-1.5 flex items-center gap-1 text-xs text-gray-400 hover:text-banana-400 transition-colors"
              >
                <Check className="w-3 h-3" />
                使用此版本
              </button>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-start">
            <div className="bg-dark-bg border border-dark-border rounded-lg px-3 py-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="p-3 border-t border-dark-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的需求..."
            disabled={isLoading || !currentPrompt.trim()}
            className="flex-1 text-sm bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-banana-500 disabled:opacity-50"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || isLoading || !currentPrompt.trim()}
            className="p-2 rounded-lg bg-banana-500 text-black hover:bg-banana-400 disabled:bg-dark-border disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        {!currentPrompt.trim() && (
          <p className="text-xs text-gray-500 mt-1.5">请先在左侧输入提示词</p>
        )}
      </div>
    </div>
  );
};
