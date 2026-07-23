import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DetectionCategory } from '../types';

export interface LocalLearningRule {
  id: string;
  pattern: string;          // literal term or regex source
  category: DetectionCategory;
  isRegex: boolean;
  label?: string;
  createdAt: string;
}

// Payload shape sent to the backend for detection.
export interface CustomRulePayload {
  pattern: string;
  category: DetectionCategory;
  isRegex: boolean;
}

interface RulesStore {
  rules: LocalLearningRule[];
  addRule: (rule: Omit<LocalLearningRule, 'id' | 'createdAt'>) => void;
  updateRule: (id: string, patch: Partial<Pick<LocalLearningRule, 'pattern' | 'category' | 'isRegex'>>) => void;
  removeRule: (id: string) => void;
  clearRules: () => void;
  hasTerm: (pattern: string) => boolean;
}

export const useRulesStore = create<RulesStore>()(
  persist(
    (set, get) => ({
      rules: [],
      addRule: (rule) => {
        // Avoid duplicates of the same pattern+category.
        if (get().rules.some((r) => r.pattern === rule.pattern && r.category === rule.category)) return;
        set((s) => ({
          rules: [
            ...s.rules,
            { ...rule, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
          ],
        }));
      },
      updateRule: (id, patch) =>
        set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      removeRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
      clearRules: () => set({ rules: [] }),
      hasTerm: (pattern) => get().rules.some((r) => r.pattern === pattern),
    }),
    { name: 'local-redactor-rules' } // persisted to localStorage, stays on device
  )
);

export function rulesToPayload(rules: LocalLearningRule[]): CustomRulePayload[] {
  return rules.map((r) => ({ pattern: r.pattern, category: r.category, isRegex: r.isRegex }));
}
