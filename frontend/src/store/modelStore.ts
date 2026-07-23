import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderId } from '../utils/api';

// User-chosen model per provider, persisted locally. Empty string = use the
// backend default for that provider.
interface ModelStore {
  models: Record<ProviderId, string>;
  setModel: (provider: ProviderId, model: string) => void;
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set) => ({
      models: { openai: '', anthropic: '' },
      setModel: (provider, model) =>
        set((s) => ({ models: { ...s.models, [provider]: model } })),
    }),
    { name: 'local-redactor-models' }
  )
);

export function getModel(provider: ProviderId): string {
  return useModelStore.getState().models[provider] ?? '';
}
