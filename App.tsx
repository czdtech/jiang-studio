import React, { useState } from 'react';
import { Sparkles, Plug } from 'lucide-react';
import { GeneratedImage, GenerationParams, GeminiSettings, ModelType, ProviderProfile, ProviderScope } from './types';
import { editImage as editGeminiImage } from './services/gemini';
import { editImage as editOpenAIImage } from './services/openai';
import { editImage as editKieImage } from './services/kie';
import { usePortfolio } from './hooks/usePortfolio';
import { EditorModal } from './components/EditorModal';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import { PortfolioGrid } from './components/PortfolioGrid';
import { OpenAIPage } from './components/OpenAIPage';
import { GeminiPage } from './components/GeminiPage';
import { KiePage } from './components/KiePage';
import { getActiveProviderId, getProviders } from './services/db';

type PageTab = 'gemini' | 'openai_proxy' | 'antigravity_tools' | 'kie' | 'portfolio';

const normalizeGeminiModel = (value: unknown): ModelType => {
  if (value === ModelType.NANO_BANANA_PRO) return ModelType.NANO_BANANA_PRO;
  if (value === ModelType.NANO_BANANA) return ModelType.NANO_BANANA;
  return ModelType.NANO_BANANA_PRO;
};

const App = () => {
  const { portfolio, saveImage, deleteImage } = usePortfolio();

  // Tab
  const [activeTab, setActiveTab] = useState<PageTab>('gemini');

  // Modals
  const [editingImage, setEditingImage] = useState<GeneratedImage | null>(null);
  const [previewData, setPreviewData] = useState<{ images: GeneratedImage[]; index: number } | null>(null);

  const handlePortfolioUpdate = async (newImage: GeneratedImage) => {
    await saveImage(newImage);
  };

  const loadProviderForEditing = async (
    scope: ProviderScope,
    preferredProviderId?: string
  ): Promise<ProviderProfile | null> => {
    try {
      const providers = await getProviders(scope);
      if (!providers.length) return null;

      if (preferredProviderId) {
        const byId = providers.find((x) => x.id === preferredProviderId);
        if (byId) return byId;
      }

      const activeId = await getActiveProviderId(scope);
      return providers.find((x) => x.id === activeId) || providers[0] || null;
    } catch (e) {
      console.warn('Failed to load providers from IndexedDB:', e);
      return null;
    }
  };

  const loadGeminiSettingsForEditing = async (
    preferredProviderId?: string
  ): Promise<{ settings: GeminiSettings; providerId?: string }> => {
    const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
    const p = await loadProviderForEditing('gemini', preferredProviderId);
    if (!p) return { settings: { apiKey: '', baseUrl: DEFAULT_GEMINI_BASE_URL } };
    return {
      settings: {
        apiKey: p.apiKey || '',
        baseUrl: p.baseUrl || DEFAULT_GEMINI_BASE_URL,
      },
      providerId: p.id,
    };
  };

  const inferImageScope = (img: GeneratedImage | null): ProviderScope => {
    if (!img) return 'gemini';
    if (img.sourceScope) return img.sourceScope;
    // 兜底：如果 model 是官方枚举值，就按官方 Gemini 处理
    if (img.model === ModelType.NANO_BANANA_PRO || img.model === ModelType.NANO_BANANA) return 'gemini';
    // 无法可靠区分第三方中转 vs Antigravity Tools 时，默认走第三方中转
    return 'openai_proxy';
  };

  const handleEditImage = async (
    sourceImage: string,
    instruction: string,
    model: ModelType,
    prevParams?: GenerationParams
  ): Promise<GeneratedImage> => {
    const scope = inferImageScope(editingImage);

    if (scope === 'gemini') {
      const { settings, providerId } = await loadGeminiSettingsForEditing(editingImage?.sourceProviderId);
      if (!settings.apiKey) {
        throw new Error('请先在「Gemini 官方」页配置 API Key（编辑功能会调用官方接口）。');
      }
      const result = await editGeminiImage(sourceImage, instruction, normalizeGeminiModel(model), settings, prevParams);
      return {
        ...result,
        sourceScope: 'gemini',
        sourceProviderId: providerId || editingImage?.sourceProviderId,
      };
    }

    if (scope === 'kie') {
      const provider = await loadProviderForEditing('kie', editingImage?.sourceProviderId);
      if (!provider) {
        throw new Error('请先在「Kie AI」页创建/选择供应商（用于编辑功能）。');
      }
      if (!provider.apiKey) {
        throw new Error('请先在「Kie AI」页配置 API Key（编辑功能会调用该供应商）。');
      }
      if (!provider.baseUrl) {
        throw new Error('请先在「Kie AI」页配置 Base URL（编辑功能会调用该供应商）。');
      }

      const modelId = String(editingImage?.model || provider.defaultModel || '').trim();
      if (!modelId) throw new Error('模型名为空，无法编辑。');

      const result = await editKieImage(
        sourceImage,
        instruction,
        modelId,
        { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
        prevParams,
        { imageInputUrls: prevParams?.referenceImages || [] }
      );

      return {
        ...result,
        sourceScope: 'kie',
        sourceProviderId: provider.id,
      };
    }

    const provider = await loadProviderForEditing(scope, editingImage?.sourceProviderId);
    const pageName = scope === 'antigravity_tools' ? 'Antigravity Tools' : '第三方中转';
    if (!provider) {
      throw new Error(`请先在「${pageName}」页创建/选择供应商（用于编辑功能）。`);
    }
    if (!provider.apiKey) {
      throw new Error(`请先在「${pageName}」页配置 API Key（编辑功能会调用该供应商）。`);
    }
    if (!provider.baseUrl) {
      throw new Error(`请先在「${pageName}」页配置 Base URL（编辑功能会调用该供应商）。`);
    }

    const modelId = String(editingImage?.model || (model as unknown as string) || provider.defaultModel || '').trim();
    if (!modelId) throw new Error('模型名为空，无法编辑。');

    const result = await editOpenAIImage(
      sourceImage,
      instruction,
      modelId,
      { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
      prevParams,
      // Antigravity Tools 推荐通过模型后缀控制比例/分辨率；编辑请求也避免额外传 aspect_ratio/size
      { imageConfig: scope === 'antigravity_tools' ? {} : undefined }
    );

    return {
      ...result,
      sourceScope: scope,
      sourceProviderId: provider.id,
    };
  };

  return (
    <div className="min-h-screen bg-dark-bg text-gray-200 font-sans selection:bg-banana-500 selection:text-black">
      {/* Navbar */}
      <nav className="border-b border-dark-border bg-dark-surface/50 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-banana-400 to-banana-600 rounded-lg flex items-center justify-center">
              <Sparkles className="text-black w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Nano Banana Studio</h1>
          </div>

          <div className="flex items-center gap-6">
            <button
              onClick={() => setActiveTab('gemini')}
              className={`text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'gemini' ? 'text-banana-400' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" /> Gemini 官方
            </button>
            <button
              onClick={() => setActiveTab('openai_proxy')}
              className={`text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'openai_proxy' ? 'text-banana-400' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Plug className="w-4 h-4" /> 第三方中转
            </button>
            <button
              onClick={() => setActiveTab('antigravity_tools')}
              className={`text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'antigravity_tools' ? 'text-banana-400' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Plug className="w-4 h-4" /> Antigravity Tools
            </button>
            <button
              onClick={() => setActiveTab('kie')}
              className={`text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'kie' ? 'text-banana-400' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Plug className="w-4 h-4" /> Kie AI
            </button>
            <button
              onClick={() => setActiveTab('portfolio')}
              className={`text-sm font-medium transition-colors ${
                activeTab === 'portfolio' ? 'text-banana-400' : 'text-gray-400 hover:text-white'
              }`}
            >
              Portfolio
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'gemini' && (
          <GeminiPage
            saveImage={saveImage}
            onImageClick={(images, index) => setPreviewData({ images, index })}
            onEdit={setEditingImage}
          />
        )}

        {activeTab === 'openai_proxy' && (
          <OpenAIPage
            variant="third_party"
            portfolio={portfolio}
            saveImage={saveImage}
            onImageClick={(images, index) => setPreviewData({ images, index })}
            onEdit={setEditingImage}
          />
        )}

        {activeTab === 'antigravity_tools' && (
          <OpenAIPage
            variant="antigravity_tools"
            portfolio={portfolio}
            saveImage={saveImage}
            onImageClick={(images, index) => setPreviewData({ images, index })}
            onEdit={setEditingImage}
          />
        )}

        {activeTab === 'kie' && (
          <KiePage
            saveImage={saveImage}
            onImageClick={(images, index) => setPreviewData({ images, index })}
            onEdit={setEditingImage}
          />
        )}

        {activeTab === 'portfolio' && (
          <PortfolioGrid
            images={portfolio}
            onImageClick={(images, index) => setPreviewData({ images, index })}
            onEdit={setEditingImage}
            onDelete={deleteImage}
          />
        )}
      </main>

      <EditorModal
        image={editingImage}
        isOpen={!!editingImage}
        onClose={() => setEditingImage(null)}
        onEditImage={handleEditImage}
        onUpdate={handlePortfolioUpdate}
      />

      <ImagePreviewModal data={previewData} onClose={() => setPreviewData(null)} onEdit={(img) => setEditingImage(img)} />
    </div>
  );
};

export default App;
