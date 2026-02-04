import React, { useState, useEffect } from 'react';
import { Edit, X, ArrowRight, ChevronDown } from 'lucide-react';
import { GeneratedImage, ModelType, GenerationParams } from '../types';
import { uploadImageFile, deleteImageFile } from '../services/gemini';
import { getProviders, getActiveProviderId } from '../services/db';
import { useToast } from './Toast';

/** Kie 支持编辑的模型列表 */
const KIE_EDIT_MODELS = [
  { id: 'google/nano-banana-edit', label: 'Nano Banana Edit（专用编辑模型）' },
  { id: 'google/nano-banana-pro', label: 'Nano Banana Pro（高质量，支持编辑）' },
];

/** 编辑函数类型 */
export type EditImageFn = (
  sourceImage: string,
  instruction: string,
  model: ModelType,
  prevParams?: GenerationParams,
  fileInfo?: { uri: string; name: string } // 可选的文件信息，用于 Gemini File API 优化
) => Promise<GeneratedImage>;

interface EditorModalProps {
  image: GeneratedImage | null;
  isOpen: boolean;
  onClose: () => void;
  onEditImage: EditImageFn;
  onUpdate: (newImg: GeneratedImage) => void;
}

export const EditorModal = ({
  image,
  isOpen,
  onClose,
  onEditImage,
  onUpdate,
}: EditorModalProps) => {
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [currentView, setCurrentView] = useState<GeneratedImage | null>(image);
  const [uploadedFileInfo, setUploadedFileInfo] = useState<{ uri: string; name: string } | null>(null);
  // Kie 编辑模型选择
  const [kieEditModel, setKieEditModel] = useState(KIE_EDIT_MODELS[0].id);
  const { showToast } = useToast();

  const isKieSource = image?.sourceScope === 'kie';

  useEffect(() => {
    setCurrentView(image);
    setPrompt('');
    setUploadedFileInfo(null); // 重置文件信息
    // 重置 Kie 编辑模型为默认值
    setKieEditModel(KIE_EDIT_MODELS[0].id);

    if (!image?.fileHandle) return;

    let cancelled = false;
    setIsLoadingSource(true);

    const load = async () => {
      try {
        const file = await image.fileHandle!.getFile();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        if (cancelled) return;
        setCurrentView((prev) => (prev ? { ...prev, base64: dataUrl } : prev));
      } catch (e) {
        if (!cancelled) {
          console.warn('Failed to load source image from fileHandle:', e);
        }
      } finally {
        if (!cancelled) setIsLoadingSource(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [image]);

  // 键盘：ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // 为 Gemini 图像上传到 File API（优化 token 使用）
  useEffect(() => {
    if (!isOpen || !image || image.sourceScope !== 'gemini') return;
    
    let cancelled = false;
    
    const uploadFile = async () => {
      try {
        // 获取 Gemini 设置
        const providers = await getProviders('gemini');
        const activeId = await getActiveProviderId('gemini');
        const provider = providers.find(p => p.id === (image.sourceProviderId || activeId)) || providers[0];
        
        if (!provider?.apiKey) return; // 没有 API Key，跳过上传
        
        const fileInfo = await uploadImageFile(image.base64, {
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl || 'https://generativelanguage.googleapis.com'
        });
        
        if (!cancelled) {
          setUploadedFileInfo(fileInfo);
          console.log('Image uploaded to File API for token optimization');
        }
      } catch (e) {
        console.warn('Failed to upload image to File API:', e);
        // 失败不影响功能，会回退到 inline data
      }
    };
    
    void uploadFile();
    
    return () => {
      cancelled = true;
    };
  }, [isOpen, image]);

  // 清理：关闭编辑器时删除上传的文件
  useEffect(() => {
    return () => {
      if (uploadedFileInfo && image?.sourceScope === 'gemini') {
        const cleanup = async () => {
          try {
            const providers = await getProviders('gemini');
            const activeId = await getActiveProviderId('gemini');
            const provider = providers.find(p => p.id === (image.sourceProviderId || activeId)) || providers[0];
            
            if (provider?.apiKey) {
              await deleteImageFile(uploadedFileInfo.name, {
                apiKey: provider.apiKey,
                baseUrl: provider.baseUrl || 'https://generativelanguage.googleapis.com'
              });
              console.log('Uploaded file cleaned up');
            }
          } catch (e) {
            console.warn('Failed to cleanup uploaded file:', e);
          }
        };
        void cleanup();
      }
    };
  }, [uploadedFileInfo, image]);

  if (!isOpen || !image) return null;

  const handleEdit = async () => {
    if (!currentView || !prompt.trim()) return;
    if (isLoadingSource) return;
    setIsProcessing(true);
    try {
      // Kie 来源使用选择的编辑模型，其他使用原图模型
      const editModel = isKieSource ? kieEditModel : (image.params.model as ModelType);
      const result = await onEditImage(
        currentView.base64,
        prompt,
        editModel as ModelType,
        currentView.params,
        uploadedFileInfo || undefined // 传递文件信息（如果有）
      );
      setCurrentView(result);
      onUpdate(result);
      setPrompt('');
      showToast('编辑已应用', 'success');
    } catch (err) {
      showToast('编辑失败：' + (err instanceof Error ? err.message : '未知错误'), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-dark-bg">
      <div className="h-14 border-b border-dark-border flex items-center justify-between px-6 bg-dark-surface shrink-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Edit className="w-5 h-5 text-banana-500" /> 编辑器
        </h2>
        <div className="flex items-center gap-4">
          {currentView?.params.imageSize && (
            <div className="text-xs bg-dark-bg border border-dark-border px-2 py-1 rounded text-gray-400">
              {currentView.params.imageSize} • {currentView.params.aspectRatio}
            </div>
          )}
          <button
            onClick={onClose}
            aria-label="关闭编辑器"
            className="p-2 hover:bg-dark-border rounded-full text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Canvas Area (Top) */}
        <div className="flex-1 bg-[#050505] flex items-center justify-center p-6 relative overflow-hidden">
          {currentView && (
            <img
              src={currentView.base64}
              alt="Editing"
              className="max-w-full max-h-full object-contain shadow-2xl border border-dark-border"
            />
          )}
          {(isProcessing || isLoadingSource) && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-sm z-10">
              <div className="bg-dark-surface/80 backdrop-blur-xl p-4 rounded-xl border border-dark-border flex items-center gap-3 shadow-2xl">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-banana-500"></div>
                <span className="text-sm font-medium text-white">
                  {isLoadingSource ? '正在加载图片…' : '正在处理编辑…'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Chat/Controls Area (Bottom) */}
        <div className="h-64 bg-dark-surface border-t border-dark-border flex flex-col shrink-0 shadow-[0_-5px_20px_rgba(0,0,0,0.5)] z-20">
          <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col items-center justify-center">
            <div className="bg-dark-bg p-3 rounded-lg border border-dark-border max-w-2xl text-center">
              <p className="text-sm text-gray-300">
                <span className="text-banana-500 font-bold">提示：</span> 描述你想怎么改。例：
                “把天空变成紫色”、“给猫戴一顶帽子”。
              </p>
            </div>
            {currentView && currentView.prompt !== image.prompt && (
              <div className="bg-banana-500/10 p-3 rounded-lg border border-banana-500/30 max-w-2xl text-center">
                <p className="text-sm text-banana-200">
                  <span className="font-bold">上一次编辑：</span> {currentView.prompt}
                </p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-dark-border bg-dark-bg/50 backdrop-blur">
            <div className="max-w-4xl mx-auto space-y-3">
              {/* Kie 模型选择器 */}
              {isKieSource && (
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-400 whitespace-nowrap">编辑模型：</label>
                  <div className="relative flex-1 max-w-xs">
                    <select
                      value={kieEditModel}
                      onChange={(e) => setKieEditModel(e.target.value)}
                      className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-banana-500 outline-none appearance-none cursor-pointer pr-8"
                    >
                      {KIE_EDIT_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              )}
              {/* 输入框和发送按钮 */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isProcessing && handleEdit()}
                  placeholder="描述你的修改…"
                  className="flex-1 bg-dark-bg border border-dark-border rounded-xl px-5 py-3 text-white focus:ring-2 focus:ring-banana-500 outline-none shadow-inner"
                />
                <button
                  onClick={handleEdit}
                  disabled={isProcessing || isLoadingSource || !prompt.trim()}
                  className="bg-banana-500 hover:bg-banana-600 disabled:opacity-50 text-black font-bold px-6 py-2 rounded-xl flex items-center gap-2 transition-transform active:scale-95"
                >
                  发送 <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
