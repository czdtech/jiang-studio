import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, Send, Check, Sparkles, X, Image as ImageIcon, History, ChevronDown } from 'lucide-react';
import { IterationMessage, IterationContext, IterationMode, GeneratedImage } from '../types';
import { iteratePrompt } from '../services/mcp';

/** 一次迭代会话的快照（内存中保留） */
interface IterationSession {
  id: string;
  /** 会话标题（取自首条用户消息或目标图片 prompt 前 40 字） */
  title: string;
  /** 关联的图片 ID（image-context 模式） */
  targetImageId?: string;
  /** 关联图片的 base64 缩略图 */
  targetImageThumb?: string;
  /** 迭代模式 */
  mode: IterationMode;
  /** 完整对话消息 */
  messages: IterationMessage[];
  /** 创建时间 */
  createdAt: number;
}

/** 快捷建议芯片（按分类分组） */
const SUGGESTION_CHIP_GROUPS = [
  { label: '构图/视角', chips: ['特写镜头', '俯瞰全景', '留出标题空间'] },
  { label: '色彩/氛围', chips: ['高饱和撞色', '暗调电影感', '青橙电影调'] },
  { label: '画质/细节', chips: ['提升清晰度', '修复人物细节', '增强光影对比'] },
];

interface IterationAssistantProps {
  /** 当前主提示词 */
  currentPrompt: string;
  /** 用户选择使用某个版本时的回调（prompt-only 模式） */
  onUseVersion: (prompt: string) => void;
  /** 迭代模板 ID */
  iterateTemplateId?: string;
  /** 模板变更回调 */
  onTemplateChange?: (templateId: string) => void;
  /** 迭代模式 */
  iterationMode?: IterationMode;
  /** 图片上下文（image-context 模式下使用） */
  iterationContext?: IterationContext;
  /** 清除图片上下文，回到 prompt-only 模式 */
  onClearContext?: () => void;
  /** 生成图片的回调（image-context 模式下，"使用此版本"后自动生成） */
  onGenerate?: (prompt: string, context: IterationContext) => Promise<void>;
  /** 切换迭代目标图片 */
  onSwitchTarget?: (image: GeneratedImage, index: number) => void;
}

export const IterationAssistant = ({
  currentPrompt,
  onUseVersion,
  iterateTemplateId = 'image-iterate-general',
  onTemplateChange: _onTemplateChange,
  iterationMode = 'prompt-only',
  iterationContext,
  onClearContext,
  onGenerate,
  onSwitchTarget,
}: IterationAssistantProps) => {
  const [messages, setMessages] = useState<IterationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [sessions, setSessions] = useState<IterationSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0); // 防止竞态：切换目标/加载历史时忽略旧请求

  const hasImageContext = iterationMode === 'image-context' && !!iterationContext;

  // 保存当前对话到历史（如果有消息的话）
  // 接受可选的 prevMode 和 prevContext 参数，用于在状态变更前保存旧值
  const saveCurrentSession = useCallback((prevMode?: IterationMode, prevContext?: IterationContext) => {
    if (messages.length === 0) return;
    const firstUserMsg = messages.find(m => m.role === 'user');
    // 使用传入的旧值，如果没有传入则使用当前值
    const modeToUse = prevMode ?? iterationMode;
    const contextToUse = prevContext ?? iterationContext;
    const hasImageContextToUse = modeToUse === 'image-context' && !!contextToUse;
    const title = hasImageContextToUse
      ? (contextToUse?.targetPrompt || '').slice(0, 40) || '单图迭代'
      : (firstUserMsg?.content || '').slice(0, 40) || '迭代会话';
    const session: IterationSession = {
      id: crypto.randomUUID(),
      title,
      targetImageId: hasImageContextToUse ? contextToUse?.targetImage.id : undefined,
      targetImageThumb: hasImageContextToUse ? contextToUse?.targetImage.base64 : undefined,
      mode: modeToUse,
      messages: [...messages],
      createdAt: Date.now(),
    };
    setSessions(prev => [session, ...prev].slice(0, 20)); // 最多保留 20 条
  }, [messages, iterationContext, iterationMode]);

  // 切换模式或切换目标图片时：保存当前对话 → 清空
  const prevModeRef = useRef(iterationMode);
  const prevContextRef = useRef<IterationContext | undefined>(iterationContext);
  const prevTargetIdRef = useRef(iterationContext?.targetImage.id);
  useEffect(() => {
    const modeChanged = prevModeRef.current !== iterationMode;
    const targetChanged = hasImageContext && prevTargetIdRef.current !== iterationContext?.targetImage.id;
    if (modeChanged || targetChanged) {
      // 使用 ref 中保存的旧值来保存会话，确保保存的是变更前的状态
      saveCurrentSession(prevModeRef.current, prevContextRef.current);
      setMessages([]);
      setInput('');
      setIsLoading(false);
      requestIdRef.current++; // 使正在进行的请求作废
      prevModeRef.current = iterationMode;
      prevContextRef.current = iterationContext;
      prevTargetIdRef.current = iterationContext?.targetImage.id;
    }
  }, [iterationMode, iterationContext, iterationContext?.targetImage.id, hasImageContext, saveCurrentSession]);

  // 点击历史下拉外部时关闭
  useEffect(() => {
    if (!showHistory) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHistory]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 自动调整 textarea 高度
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = Math.min(Math.max(textarea.scrollHeight, 38), 160);
    textarea.style.height = `${newHeight}px`;
  }, [input]);

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
      const parent = containerRef.current?.parentElement;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const newWidth = parentRect.right - clientX;
      parent.style.width = `${Math.max(280, Math.min(600, newWidth))}px`;
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

  // 发送消息（核心逻辑，支持直接传入文本）
  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: IterationMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // 竞态保护：记住当前请求 ID，响应回来时对比
    const currentRequestId = ++requestIdRef.current;

    try {
      // image-context 模式：使用目标图片的 prompt 作为基础
      const fallbackPrompt = hasImageContext
        ? iterationContext.targetPrompt
        : currentPrompt;

      // 用最后一条 AI 回复继续迭代，否则用原始 prompt
      const basePrompt = messages.length > 0
        ? messages.filter((m) => m.role === 'assistant').pop()?.content || fallbackPrompt
        : fallbackPrompt;

      // 视觉迭代：传递图片上下文给 MCP
      const mcpContext = hasImageContext ? {
        targetImageBase64: iterationContext.targetImage.base64,
        targetImagePrompt: iterationContext.targetPrompt,
      } : undefined;

      const result = await iteratePrompt(basePrompt, userMessage.content, iterateTemplateId, mcpContext);

      // 忽略过时的请求（用户已切换目标或加载了历史）
      if (requestIdRef.current !== currentRequestId) return;

      const assistantMessage: IterationMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      if (requestIdRef.current !== currentRequestId) return;
      const errorMessage: IterationMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `优化失败：${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      if (requestIdRef.current === currentRequestId) {
        setIsLoading(false);
      }
    }
  };

  const effectivePrompt = hasImageContext ? (iterationContext?.targetPrompt || '') : currentPrompt;
  const isDisabled = isLoading || !effectivePrompt.trim();
  const canSend = !!input.trim() && !isDisabled;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const handleChipClick = (text: string) => {
    void sendMessage(text);
  };

  const inputElement = (
    <div className="aurora-chat-input">
      <textarea
        ref={textareaRef}
        rows={1}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isDisabled ? '请先在左侧输入提示词' : '描述修改需求...'}
        disabled={isDisabled}
        className="aurora-chat-input-textarea"
      />
      <button
        type="button"
        onClick={() => void sendMessage(input)}
        disabled={!canSend}
        className="aurora-chat-input-send"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <div
      ref={containerRef}
      className="aurora-assistant-root"
    >
      {/* 拖拽手柄 */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{ touchAction: 'none' }}
        className={`aurora-assistant-resize ${isResizing ? 'active' : ''}`}
      />

      {/* 标题栏 */}
      <div className="aurora-assistant-header">
        <MessageCircle className="aurora-assistant-header-icon" />
        <span className="aurora-assistant-header-title">
          {hasImageContext ? '单图迭代' : '迭代助手'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* 历史记录按钮 */}
          {sessions.length > 0 && (
            <div ref={historyRef} className="relative">
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="p-1 text-text-muted hover:text-text-primary transition-colors rounded"
                title={`历史记录 (${sessions.length})`}
              >
                <History className="w-3.5 h-3.5" />
              </button>
              {showHistory && (
                <div className="aurora-assistant-history-dropdown">
                  <div className="aurora-assistant-history-title">
                    <History className="w-3 h-3" />
                    历史会话
                    <span className="text-text-muted">({sessions.length})</span>
                  </div>
                  {sessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="aurora-assistant-history-item"
                      onClick={() => {
                        if (isLoading) return; // 请求中不允许切换
                        requestIdRef.current++; // 使可能残留的请求作废
                        setMessages(s.messages);
                        setShowHistory(false);
                      }}
                    >
                      {s.targetImageThumb && (
                        <img
                          src={s.targetImageThumb}
                          alt=""
                          className="aurora-assistant-history-thumb"
                        />
                      )}
                      <div className="aurora-assistant-history-info">
                        <div className="aurora-assistant-history-item-title">{s.title}</div>
                        <div className="aurora-assistant-history-meta">
                          {s.messages.length} 条消息 · {new Date(s.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <ChevronDown className="w-3 h-3 -rotate-90 text-text-muted shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {hasImageContext && onClearContext && (
            <button
              type="button"
              onClick={onClearContext}
              className="p-1 text-text-muted hover:text-text-primary transition-colors rounded"
              title="退出单图模式"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 图片上下文区域 */}
      {hasImageContext && iterationContext && (
        <div className="aurora-assistant-image-context">
          <div className="aurora-assistant-image-context-row">
            <img
              src={iterationContext.targetImage.base64}
              alt="迭代目标"
              className="aurora-assistant-image-context-thumb"
            />
            <div className="aurora-assistant-image-context-info">
              <div className="text-xs text-text-secondary font-medium truncate">
                {iterationContext.targetPrompt.length > 60
                  ? iterationContext.targetPrompt.slice(0, 60) + '…'
                  : iterationContext.targetPrompt}
              </div>
              <div className="text-[10px] text-text-muted">
                第 {iterationContext.selectedImageIndex + 1} 张 / 共 {iterationContext.allImages.length} 张
              </div>
            </div>
          </div>
          {/* 所有图片缩略图（点击切换目标） */}
          {iterationContext.allImages.length > 1 && (
            <div className="aurora-assistant-image-context-all">
              {iterationContext.allImages.map((img, idx) => (
                <button
                  type="button"
                  key={img.id}
                  className={`aurora-assistant-image-context-mini ${
                    idx === iterationContext.selectedImageIndex ? 'selected' : ''
                  }`}
                  onClick={() => {
                    if (idx !== iterationContext.selectedImageIndex && onSwitchTarget) {
                      onSwitchTarget(img, idx);
                    }
                  }}
                  title={idx === iterationContext.selectedImageIndex ? '当前目标' : `切换到图片 ${idx + 1}`}
                >
                  <img src={img.base64} alt={`图片 ${idx + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 消息区域 */}
      <div className="aurora-assistant-messages">
        {messages.length === 0 && !isLoading ? (
          /* 空状态 */
          <div className="aurora-assistant-empty">
            {hasImageContext ? (
              <ImageIcon className="aurora-assistant-empty-icon" />
            ) : (
              <Sparkles className="aurora-assistant-empty-icon" />
            )}
            <div className="aurora-assistant-empty-text">
              <p className="aurora-assistant-empty-title">
                {hasImageContext ? '描述你对这张图的修改需求' : '描述你的修改需求'}
              </p>
              <p className="aurora-assistant-empty-desc">
                {hasImageContext
                  ? 'AI 将基于该图的提示词进行迭代优化，生成新图追加到列表'
                  : 'AI 将帮你逐步迭代优化提示词'}
              </p>
            </div>
            <div className="aurora-assistant-chip-groups">
              {SUGGESTION_CHIP_GROUPS.map((group) => (
                <div key={group.label} className="aurora-assistant-chip-group">
                  <span className="aurora-assistant-chip-group-label">{group.label}</span>
                  <div className="aurora-assistant-chips">
                    {group.chips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => handleChipClick(chip)}
                        className="aurora-assistant-chip"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="aurora-assistant-inline-input">
              {inputElement}
            </div>
          </div>
        ) : (
          /* 消息列表 */
          <div className="aurora-assistant-messages-inner">
            {messages.map((msg) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="aurora-assistant-msg-user">
                  <div className="aurora-assistant-msg-user-bubble">
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="aurora-assistant-msg-ai">
                  <div className={`aurora-assistant-msg-ai-bubble ${msg.content.startsWith('优化失败') ? 'is-error' : ''}`}>
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    {!msg.content.startsWith('优化失败') && (
                      <button
                        type="button"
                        onClick={() => {
                          if (hasImageContext && iterationContext && onGenerate) {
                            void onGenerate(msg.content, iterationContext);
                          } else {
                            onUseVersion(msg.content);
                          }
                        }}
                        className="aurora-assistant-msg-use"
                      >
                        <Check className="w-3 h-3" />
                        {hasImageContext ? '使用此版本并生成' : '使用此版本'}
                      </button>
                    )}
                  </div>
                </div>
              ),
            )}

            {isLoading && (
              <div className="aurora-assistant-loading">
                <div className="aurora-assistant-loading-bubble">
                  <span className="aurora-assistant-loading-dot" />
                  <span className="aurora-assistant-loading-dot" />
                  <span className="aurora-assistant-loading-dot" />
                </div>
              </div>
            )}

            <div className="aurora-assistant-inline-input">
              {inputElement}
            </div>

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};
