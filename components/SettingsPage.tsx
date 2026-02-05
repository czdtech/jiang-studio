import React, { useEffect, useState } from 'react';
import { 
  Plug, 
  Settings2, 
  Wand2, 
  Trash2, 
  Plus, 
  Star, 
  RefreshCw,
  Cpu,
  Layout,
  Layers,
  Save
} from 'lucide-react';
import { useGenerationSettings } from '../contexts/GenerationSettingsContext';
import { 
  ProviderProfile, 
  ProviderScope, 
  ProviderModelsCache,
  ModelType,
  GenerationParams
} from '../types';
import { 
  getProviders, 
  upsertProvider, 
  deleteProvider, 
  getActiveProviderId, 
  setActiveProviderId as saveActiveProviderId 
} from '../services/db';
import { fetchOpenAIModels } from '../services/openai';

const inputBaseStyles = "w-full bg-void border border-ash rounded-[var(--radius-md)] px-3 py-2 text-sm text-text-primary focus:border-banana-500 focus:outline-none placeholder:text-text-muted transition-colors";
const selectBaseStyles = "w-full bg-void border border-ash rounded-[var(--radius-md)] px-3 py-2 text-sm text-text-primary focus:border-banana-500 focus:outline-none transition-colors appearance-none";

export const SettingsPage: React.FC = () => {
  const { 
    activeProviderId, 
    setActiveProviderId, 
    customModel, 
    setCustomModel,
    params,
    updateParams,
    optimizerConfig,
    setOptimizerConfig,
    batchConfig,
    setBatchConfig
  } = useGenerationSettings();

  // 本地状态：供应商管理
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [providerName, setProviderName] = useState('');
  const [settings, setSettings] = useState({ apiKey: '', baseUrl: '' });
  const [scope, setScope] = useState<ProviderScope>('openai_proxy'); // 默认配置 Scope
  
  // 本地状态：模型列表
  const [availableImageModels, setAvailableImageModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsHint, setModelsHint] = useState('');

  // 初始化加载供应商列表
  useEffect(() => {
    loadProviders();
  }, [scope]); // 当 scope 切换时重新加载

  // 当 activeProviderId 变化时，填充表单
  useEffect(() => {
    if (!activeProviderId) return;
    const p = providers.find(x => x.id === activeProviderId);
    if (p) {
      setProviderName(p.name);
      setSettings({ apiKey: p.apiKey, baseUrl: p.baseUrl });
      // 加载该供应商缓存的模型
      if (p.modelsCache) {
        setAvailableImageModels(p.modelsCache.image);
        setModelsHint(`Cached: ${new Date(p.modelsCache.fetchedAt).toLocaleTimeString()}`);
      } else {
        setAvailableImageModels([]);
        setModelsHint('');
      }
    }
  }, [activeProviderId, providers]);

  const loadProviders = async () => {
    const list = await getProviders(scope);
    setProviders(list);
    const active = await getActiveProviderId(scope);
    if (active && list.find(p => p.id === active)) {
      setActiveProviderId(active, scope);
    } else if (list.length > 0) {
      // 默认选中第一个
      await handleSelectProvider(list[0].id);
    } else {
      // 无供应商，创建默认
      await handleCreateProvider(true);
    }
  };

  const handleSelectProvider = async (id: string) => {
    await saveActiveProviderId(scope, id);
    setActiveProviderId(id, scope);
  };

  const handleCreateProvider = async (isInit = false) => {
    const newId = crypto.randomUUID();
    const newProvider: ProviderProfile = {
      id: newId,
      scope,
      name: isInit ? '默认供应商' : '新供应商',
      apiKey: '',
      baseUrl: scope === 'antigravity_tools' ? '/antigravity' : 'https://api.openai.com',
      defaultModel: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await upsertProvider(newProvider);
    await loadProviders();
    await handleSelectProvider(newId);
  };

  const handleSaveProvider = async () => {
    if (!activeProviderId) return;
    const current = providers.find(p => p.id === activeProviderId);
    if (!current) return;

    // 如果是通过 UI 修改的，更新状态；
    // 注意：这里没有复杂的“未保存”逻辑，简化为修改即保存（或点击保存按钮）
    // 为了体验更好，我们在 blur 或点击保存时触发
    const updated: ProviderProfile = {
      ...current,
      name: providerName,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      updatedAt: Date.now(),
    };
    await upsertProvider(updated);
    // 重新加载以刷新列表显示
    await loadProviders(); 
  };

  const handleDeleteProvider = async () => {
    if (!activeProviderId || providers.length <= 1) return;
    if (!confirm('确定删除此供应商配置吗？')) return;
    await deleteProvider(activeProviderId);
    await loadProviders();
  };

  const handleRefreshModels = async () => {
    if (!settings.apiKey || !settings.baseUrl) return;
    setIsLoadingModels(true);
    setModelsHint('Fetching...');
    try {
      const fetched = await fetchOpenAIModels({ apiKey: settings.apiKey, baseUrl: settings.baseUrl });
      
      // 更新 DB
      const p = providers.find(x => x.id === activeProviderId);
      if (p) {
        const cache: ProviderModelsCache = {
          all: fetched.map(m => m.id),
          image: fetched.map(m => m.id), // 这里简单处理，假设都可用作图像模型（或由用户筛选）
          fetchedAt: Date.now(),
        };
        await upsertProvider({ ...p, modelsCache: cache });
        setAvailableImageModels(cache.image);
        setProviders(prev => prev.map(item => item.id === p.id ? { ...item, modelsCache: cache } : item));
        setModelsHint(`Updated: ${new Date().toLocaleTimeString()}`);
      }
    } catch (err) {
      console.error(err);
      setModelsHint('Failed to fetch');
    } finally {
      setIsLoadingModels(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 animate-fade-in">
      <div className="flex items-center gap-3 mb-8">
        <Settings2 className="w-8 h-8 text-banana-500" />
        <h1 className="text-2xl font-bold text-text-primary">设置中心</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* 左列：连接与供应商 */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2">
            <Plug className="w-5 h-5 text-banana-400" />
            <h2 className="text-lg font-semibold text-text-primary">连接配置</h2>
          </div>

          {/* Scope 切换 */}
          <div className="flex gap-2 p-1 bg-void rounded-[var(--radius-md)] border border-ash/50">
            {(['openai_proxy', 'antigravity_tools'] as ProviderScope[]).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`flex-1 py-1.5 text-xs rounded-md transition-all ${
                  scope === s 
                    ? 'bg-banana-500/20 text-banana-500 font-medium' 
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {s === 'openai_proxy' ? 'OpenAI / 中转' : 'Antigravity'}
              </button>
            ))}
          </div>

          {/* 供应商列表操作 */}
          <div className="space-y-3 p-4 bg-void/30 border border-white/5 rounded-xl">
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-muted">当前配置组合</span>
              <div className="flex gap-2">
                 <button onClick={() => void handleCreateProvider()} className="p-1.5 hover:bg-white/10 rounded-md text-text-muted hover:text-banana-500 transition-colors" title="新建">
                   <Plus className="w-4 h-4" />
                 </button>
                 <button onClick={handleDeleteProvider} className="p-1.5 hover:bg-white/10 rounded-md text-text-muted hover:text-error transition-colors" title="删除">
                   <Trash2 className="w-4 h-4" />
                 </button>
              </div>
            </div>
            <select
              value={activeProviderId}
              onChange={(e) => handleSelectProvider(e.target.value)}
              className={selectBaseStyles}
            >
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* 详细配置表单 */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">配置名称</label>
              <input 
                value={providerName} 
                onChange={e => setProviderName(e.target.value)} 
                onBlur={handleSaveProvider}
                className={inputBaseStyles} 
              />
            </div>
            
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Base URL</label>
              <input 
                value={settings.baseUrl} 
                onChange={e => setSettings(s => ({ ...s, baseUrl: e.target.value }))} 
                onBlur={handleSaveProvider}
                placeholder="https://api.openai.com/v1"
                className={inputBaseStyles} 
              />
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1.5">API Key</label>
              <input 
                type="password"
                value={settings.apiKey} 
                onChange={e => setSettings(s => ({ ...s, apiKey: e.target.value }))} 
                onBlur={handleSaveProvider}
                placeholder="sk-..."
                className={inputBaseStyles} 
              />
            </div>
            
            <button 
               onClick={handleSaveProvider}
               className="w-full py-2 bg-banana-500/10 text-banana-500 hover:bg-banana-500/20 border border-banana-500/20 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              保存连接配置
            </button>
          </div>
        </section>

        {/* 右列：生成偏好 */}
        <section className="space-y-8">
          
          {/* Default Model */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2">
              <Cpu className="w-5 h-5 text-banana-400" />
              <h2 className="text-lg font-semibold text-text-primary">模型偏好</h2>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                 <label className="text-sm text-text-muted">默认生成模型</label>
                 <button 
                   onClick={handleRefreshModels} 
                   disabled={isLoadingModels || !settings.apiKey}
                   className="text-xs flex items-center gap-1 text-banana-500 hover:text-banana-400 disabled:opacity-50"
                 >
                   <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                   {isLoadingModels ? '刷新中...' : '刷新列表'}
                 </button>
              </div>
              
              <div className="relative">
                <select
                  value={availableImageModels.includes(customModel) ? customModel : ''}
                  onChange={(e) => setCustomModel(e.target.value)}
                  className={selectBaseStyles}
                >
                  <option value="" disabled>选择模型...</option>
                  {availableImageModels.includes(customModel) ? null : <option value={customModel}>{customModel} (当前)</option>}
                  {availableImageModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              
              <input 
                placeholder="或手动输入模型 ID" 
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                className={inputBaseStyles}
              />
              <p className="text-xs text-text-muted">{modelsHint}</p>
            </div>
          </div>

          {/* Imaging Specs */}
          <div className="space-y-4">
             <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2">
              <Layout className="w-5 h-5 text-banana-400" />
              <h2 className="text-lg font-semibold text-text-primary">画幅设置</h2>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-text-muted">默认比例</label>
                <select
                  value={params.aspectRatio}
                  onChange={(e) => updateParams({ aspectRatio: e.target.value as any })}
                  className={selectBaseStyles}
                >
                   {['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'].map(r => (
                     <option key={r} value={r}>{r}</option>
                   ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-text-muted">分辨率/尺寸</label>
                <select
                  value={params.imageSize}
                  onChange={(e) => updateParams({ imageSize: e.target.value as any })}
                  className={selectBaseStyles}
                >
                   {['1K', '2K', '4K'].map(s => (
                     <option key={s} value={s}>{s}</option>
                   ))}
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                <label className="text-sm text-text-muted">批量并发</label>
                <select
                   value={batchConfig.concurrency}
                   onChange={(e) => setBatchConfig({ ...batchConfig, concurrency: Number(e.target.value) })}
                   className={selectBaseStyles}
                >
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} 线程</option>)}
                </select>
              </div>
               <div className="space-y-2">
                <label className="text-sm text-text-muted">单词张数</label>
                <select
                   value={batchConfig.countPerPrompt}
                   onChange={(e) => setBatchConfig({ ...batchConfig, countPerPrompt: Number(e.target.value) })}
                   className={selectBaseStyles}
                >
                  {[1,2,3,4].map(n => <option key={n} value={n}>{n} 张</option>)}
                </select>
              </div>
            </div>
          </div>

           {/* Optimizer */}
           <div className="space-y-4">
             <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2">
              <Wand2 className="w-5 h-5 text-banana-400" />
              <h2 className="text-lg font-semibold text-text-primary">智能助手</h2>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-void rounded-lg border border-ash/50">
               <div>
                  <h3 className="text-sm font-medium text-text-primary">启用提示词优化器</h3>
                  <p className="text-xs text-text-muted">生成前自动润色提示词</p>
               </div>
               <button 
                 onClick={() => setOptimizerConfig({ ...optimizerConfig, enabled: !optimizerConfig.enabled })}
                 className={`w-10 h-5 rounded-full transition-colors relative ${optimizerConfig.enabled ? 'bg-banana-500' : 'bg-ash'}`}
               >
                 <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${optimizerConfig.enabled ? 'translate-x-5' : ''}`} />
               </button>
            </div>
          </div>

        </section>
      </div>
    </div>
  );
};
