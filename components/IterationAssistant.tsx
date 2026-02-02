import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, Check } from 'lucide-react';
import { IterationMessage } from '../types';
import { iteratePrompt } from '../services/mcp';

interface IterationAssistantProps {
  /** 当前主提示词 */
  currentPrompt: string;
  /** 用户选择使用某个版本时的回调 */
  onUseVersion: (prompt: string) => void;
}

export const IterationAssistant = ({
  currentPrompt,
  onUseVersion,
}: IterationAssistantProps) => {
  const [messages, setMessages] = useState<IterationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [width, setWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 处理拖拽调整宽度
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      setWidth(Math.max(280, Math.min(600, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
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

      const result = await iteratePrompt(basePrompt, userMessage.content);

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
        className={`absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-banana-500/50 transition-colors ${
          isResizing ? 'bg-banana-500' : ''
        }`}
      />

      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-border">
        <MessageCircle className="w-4 h-4 text-banana-400" />
        <span className="text-sm font-medium text-gray-200">迭代助手</span>
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
