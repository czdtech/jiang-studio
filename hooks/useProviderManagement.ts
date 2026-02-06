import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import {
  deleteProvider as deleteProviderFromDb,
  getActiveProviderId as getActiveProviderIdFromDb,
  getDraft as getDraftFromDb,
  getProviders as getProvidersFromDb,
  setActiveProviderId as setActiveProviderIdInDb,
  upsertDraft as upsertDraftInDb,
  upsertProvider as upsertProviderInDb,
} from '../services/db';
import { GenerationParams, ProviderDraft, ProviderProfile, ProviderScope } from '../types';

interface UseProviderManagementProps {
  scope: ProviderScope;
  createDefaultProvider: (scope: ProviderScope) => ProviderProfile;
  onDraftLoaded: (draft: ProviderDraft | null, defaultModel?: string) => void;
  draftState: {
    prompt: string;
    params: GenerationParams;
    refImages: string[];
    model: string;
  };
}

export function useProviderManagement({
  scope,
  createDefaultProvider,
  onDraftLoaded,
  draftState,
}: UseProviderManagementProps) {
  const { showToast } = useToast();

  // Provider State
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [activeProviderId, setActiveProviderIdState] = useState<string>('');

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === activeProviderId) || null,
    [providers, activeProviderId]
  );

  // Editable Provider Settings State
  const [providerName, setProviderName] = useState<string>('');
  const [providerFavorite, setProviderFavorite] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>('');
  const [baseUrl, setBaseUrl] = useState<string>('');

  // Refs for coordination
  const isHydratingRef = useRef(false);
  const hydratedProviderIdRef = useRef<string | null>(null);
  const deletingProviderIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 1. Initialization: Load providers and active ID
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const list = await getProvidersFromDb(scope);
      let nextProviders = list;

      if (nextProviders.length === 0) {
        const def = createDefaultProvider(scope);
        await upsertProviderInDb(def);
        nextProviders = [def];
      }

      // Special fix for Antigravity Tools (Legacy relative URL fix)
      if (scope === 'antigravity_tools') {
        const needsFix = nextProviders.filter(
          (p) => p.baseUrl && !p.baseUrl.startsWith('http')
        );
        for (const p of needsFix) {
          console.log('[useProviderManagement] Auto-fixing Antigravity baseUrl:', p.baseUrl, '->', 'http://127.0.0.1:8045');
          const fixed: ProviderProfile = {
            ...p,
            baseUrl: 'http://127.0.0.1:8045',
            updatedAt: Date.now(),
          };
          await upsertProviderInDb(fixed);
        }
        if (needsFix.length > 0) {
          nextProviders = await getProvidersFromDb(scope);
        }
      }

      const savedActiveId = await getActiveProviderIdFromDb(scope);
      const fallbackId = nextProviders[0]?.id || '';
      const nextActiveId =
        savedActiveId && nextProviders.some((p) => p.id === savedActiveId)
          ? savedActiveId
          : fallbackId;

      if (!savedActiveId || savedActiveId !== nextActiveId) {
        if (nextActiveId) await setActiveProviderIdInDb(scope, nextActiveId);
      }

      if (cancelled) return;
      setProviders(nextProviders);
      setActiveProviderIdState(nextActiveId);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [scope]); // createDefaultProvider is assumed stable or ignored for dep

  // 2. Hydration: When active provider changes, load settings and draft
  useEffect(() => {
    if (!activeProvider) return;
    if (hydratedProviderIdRef.current === activeProvider.id) return;

    // Set hydrated ref immediately to block persistence effects during hydration
    hydratedProviderIdRef.current = activeProvider.id;
    isHydratingRef.current = true;

    let cancelled = false;

    // Load settings from provider
    setApiKey(activeProvider.apiKey || '');
    setBaseUrl(activeProvider.baseUrl || '');
    setProviderName(activeProvider.name);
    setProviderFavorite(!!activeProvider.favorite);

    const loadDraft = async () => {
      try {
        const draft = await getDraftFromDb(scope, activeProvider.id);
        if (cancelled) return;
        onDraftLoaded(draft, activeProvider.defaultModel);
      } catch (e) {
        console.warn('Failed to load draft:', e);
      } finally {
        if (!cancelled) {
          isHydratingRef.current = false;
        }
      }
    };

    void loadDraft();

    return () => {
      cancelled = true;
    };
  }, [activeProvider, scope, onDraftLoaded]);

  // 3. Persistence: Save provider updates (debounced)
  useEffect(() => {
    if (!activeProvider) return;
    if (isHydratingRef.current) return;

    // Base URL default handling depends on scope, but usually handled by UI placeholder or createDefault.
    // Here we save exactly what is in state.

    const next: ProviderProfile = {
      ...activeProvider,
      name: providerName || activeProvider.name,
      favorite: providerFavorite,
      apiKey: apiKey,
      baseUrl: baseUrl,
      defaultModel: draftState.model, // Update default model to current model
      // Note: modelsCache is preserved from activeProvider unless baseUrl changes
      modelsCache: baseUrl !== activeProvider.baseUrl ? undefined : activeProvider.modelsCache,
      updatedAt: Date.now(),
    };

    const t = window.setTimeout(() => {
      if (deletingProviderIdRef.current === next.id) return;
      void upsertProviderInDb(next).catch((e) => console.warn('Failed to save provider:', e));

      // Update local state without triggering re-hydration (since ID hasn't changed)
      setProviders((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    }, 300);

    return () => window.clearTimeout(t);
  }, [
    activeProvider,
    providerName,
    providerFavorite,
    apiKey,
    baseUrl,
    draftState.model, // Watch model changes to update defaultModel
  ]);

  // 4. Persistence: Save draft updates (debounced)
  useEffect(() => {
    if (!activeProvider) return;
    if (isHydratingRef.current) return;

    const draft: ProviderDraft = {
      scope,
      providerId: activeProvider.id,
      prompt: draftState.prompt,
      params: draftState.params,
      refImages: draftState.refImages,
      model: draftState.model,
      updatedAt: Date.now(),
    };

    const t = window.setTimeout(() => {
      void upsertDraftInDb(draft).catch((e) => console.warn('Failed to save draft:', e));
    }, 350);

    return () => window.clearTimeout(t);
  }, [
    activeProvider,
    scope,
    draftState.prompt,
    draftState.params,
    draftState.refImages,
    draftState.model,
  ]);

  // Actions
  const handleSelectProvider = async (nextId: string) => {
    setActiveProviderIdState(nextId);
    await setActiveProviderIdInDb(scope, nextId);
  };

  const handleCreateProvider = async () => {
    const base = createDefaultProvider(scope);
    const now = Date.now();
    const created: ProviderProfile = {
      ...base,
      id: crypto.randomUUID(),
      name: '新供应商',
      favorite: false,
      createdAt: now,
      updatedAt: now,
      // Ensure specific fields are reset if createDefaultProvider didn't do it
    };

    await upsertProviderInDb(created);
    const next = await getProvidersFromDb(scope);
    setProviders(next);
    await handleSelectProvider(created.id);
  };

  const handleDeleteProvider = async () => {
    if (!activeProvider) return;
    if (providers.length <= 1) {
      showToast('至少保留一个供应商', 'error');
      return;
    }
    if (!confirm(`删除供应商「${activeProvider.name}」？`)) return;

    deletingProviderIdRef.current = activeProvider.id;
    try {
      await deleteProviderFromDb(activeProvider.id);
      const next = await getProvidersFromDb(scope);
      setProviders(next);
      const nextActive = next[0]?.id || '';
      if (nextActive) await handleSelectProvider(nextActive);
    } finally {
      deletingProviderIdRef.current = null;
    }
  };

  const toggleFavorite = () => {
    setProviderFavorite((v) => !v);
  };

  // Helper to update active provider directly (e.g. for modelsCache updates)
  const updateActiveProvider = async (updates: Partial<ProviderProfile>) => {
    if (!activeProvider) return;
    const updated: ProviderProfile = {
      ...activeProvider,
      ...updates,
      updatedAt: Date.now(),
    };

    // We update DB immediately for explicit actions (like refresh models)
    await upsertProviderInDb(updated);
    setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));

    // Also update local state if relevant fields changed
    if (updates.name !== undefined) setProviderName(updates.name);
    if (updates.favorite !== undefined) setProviderFavorite(updates.favorite);
    if (updates.apiKey !== undefined) setApiKey(updates.apiKey);
    if (updates.baseUrl !== undefined) setBaseUrl(updated.baseUrl);
  };

  return {
    providers,
    activeProviderId,
    activeProvider,

    // Settings State
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
    providerName,
    setProviderName,
    providerFavorite,

    // Actions
    handleSelectProvider,
    handleCreateProvider,
    handleDeleteProvider,
    toggleFavorite,
    updateActiveProvider,
  };
}
