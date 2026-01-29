import React, { useState, useEffect } from 'react';
import { Edit, X, ArrowRight } from 'lucide-react';
import { GeneratedImage, ModelType, GenerationParams } from '../types';
import { useToast } from './Toast';

/** 编辑函数类型 */
export type EditImageFn = (
  sourceImage: string,
  instruction: string,
  model: ModelType,
  prevParams?: GenerationParams
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
  const { showToast } = useToast();

  useEffect(() => {
    setCurrentView(image);
    setPrompt('');

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

  if (!isOpen || !image) return null;

  const handleEdit = async () => {
    if (!currentView || !prompt.trim()) return;
    if (isLoadingSource) return;
    setIsProcessing(true);
    try {
      const result = await onEditImage(
        currentView.base64,
        prompt,
        image.params.model as ModelType,
        currentView.params
      );
      setCurrentView(result);
      onUpdate(result);
      setPrompt('');
      showToast('Edit applied successfully', 'success');
    } catch (err) {
      showToast('Edit failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-dark-bg">
      <div className="h-14 border-b border-dark-border flex items-center justify-between px-6 bg-dark-surface shrink-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Edit className="w-5 h-5 text-banana-500" /> Editor
        </h2>
        <div className="flex items-center gap-4">
          {currentView?.params.imageSize && (
            <div className="text-xs bg-dark-bg border border-dark-border px-2 py-1 rounded text-gray-400">
              {currentView.params.imageSize} • {currentView.params.aspectRatio}
            </div>
          )}
          <button
            onClick={onClose}
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
              <div className="bg-dark-surface p-4 rounded-xl border border-dark-border flex items-center gap-3 shadow-2xl">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-banana-500"></div>
                <span className="text-sm font-medium text-white">
                  {isLoadingSource ? 'Loading image...' : 'Processing Edit...'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Chat/Controls Area (Bottom) */}
        <div className="h-64 bg-dark-surface border-t border-dark-border flex flex-col shrink-0 shadow-[0_-5px_20px_rgba(0,0,0,0.5)] z-20">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="bg-dark-bg p-3 rounded-lg border border-dark-border max-w-2xl">
              <p className="text-sm text-gray-300">
                <span className="text-banana-500 font-bold">System:</span> Describe what you want to change. Example:
                "Make the sky purple" or "Add a hat to the cat".
              </p>
            </div>
            {currentView && currentView.prompt !== image.prompt && (
              <div className="bg-banana-500/10 p-3 rounded-lg border border-banana-500/30 max-w-2xl">
                <p className="text-sm text-banana-200">
                  <span className="font-bold">Last Edit:</span> {currentView.prompt}
                </p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-dark-border bg-dark-bg/50 backdrop-blur">
            <div className="max-w-4xl mx-auto flex gap-2">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isProcessing && handleEdit()}
                placeholder="Describe your edit..."
                className="flex-1 bg-dark-bg border border-dark-border rounded-xl px-5 py-3 text-white focus:ring-2 focus:ring-banana-500 outline-none shadow-inner"
              />
              <button
                onClick={handleEdit}
                disabled={isProcessing || isLoadingSource || !prompt.trim()}
                className="bg-banana-500 hover:bg-banana-600 disabled:opacity-50 text-black font-bold px-6 py-2 rounded-xl flex items-center gap-2 transition-transform active:scale-95"
              >
                Send <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
