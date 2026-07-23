import { create } from 'zustand';
import type { AppMode, SensitiveEntity, PlaceholderMapping } from '../types';

export interface Attachment {
  id: string;
  name: string;
  text: string;
  warnings: string[];
}

// Full audit trail of one exchange, attached to the assistant message.
export interface ExchangeRecord {
  original: string;          // what the user typed/uploaded
  anonymisedPrompt: string;  // exactly what was sent to / produced for the LLM
  llmOutput: string;         // raw (still-anonymised) LLM response
  restoredOutput: string;    // de-anonymised final result
  mode: AppMode;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  // For user messages: how many entities were anonymised before sending
  anonymisedCount?: number;
  // For assistant messages: restoration warnings count
  warningCount?: number;
  // For assistant messages: full four-part record of the exchange
  record?: ExchangeRecord;
}

// State for the "review before sending" panel
export interface ReviewDraft {
  originalText: string;
  anonymisedText: string;
  entities: SensitiveEntity[];
  // NER was expected but failed (timeout/error) — only structured data was caught.
  nerPartial?: boolean;
}

interface ChatStore {
  mode: AppMode;
  messages: ChatMessage[];
  attachments: Attachment[];
  input: string;
  runningMappings: PlaceholderMapping[];
  review: ReviewDraft | null;
  busy: boolean;
  // Whether local NER (Ollama) is reachable. null = not yet checked.
  nerAvailable: boolean | null;
  // Selected external provider for Approved External mode.
  provider: 'mock' | 'openai' | 'anthropic';
  // Enable the provider's web-search tool (anonymised query goes to the web).
  webSearch: boolean;
  // Live NER progress while the local model scans chunks. null = not running.
  nerProgress: { done: number; total: number } | null;
  // Private-local manual paste-back panel
  localPending: { original: string; anonymisedText: string } | null;

  setMode: (mode: AppMode) => void;
  setInput: (input: string) => void;
  addAttachment: (a: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  addMessage: (m: ChatMessage) => void;
  setRunningMappings: (m: PlaceholderMapping[]) => void;
  setReview: (r: ReviewDraft | null) => void;
  updateReviewEntity: (id: string, patch: Partial<SensitiveEntity>) => void;
  addReviewEntity: (e: SensitiveEntity) => void;
  removeReviewEntity: (id: string) => void;
  setBusy: (b: boolean) => void;
  setNerAvailable: (b: boolean) => void;
  setProvider: (p: 'mock' | 'openai' | 'anthropic') => void;
  setWebSearch: (b: boolean) => void;
  setNerProgress: (p: { done: number; total: number } | null) => void;
  setLocalPending: (p: { original: string; anonymisedText: string } | null) => void;
  clearSession: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  mode: 'approved-external',
  messages: [],
  attachments: [],
  input: '',
  runningMappings: [],
  review: null,
  busy: false,
  nerAvailable: null,
  provider: 'mock',
  webSearch: true,
  nerProgress: null,
  localPending: null,

  setMode: (mode) => set({ mode }),
  setInput: (input) => set({ input }),
  addAttachment: (a) => set((s) => ({ attachments: [...s.attachments, a] })),
  removeAttachment: (id) => set((s) => ({ attachments: s.attachments.filter((x) => x.id !== id) })),
  clearAttachments: () => set({ attachments: [] }),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  setRunningMappings: (runningMappings) => set({ runningMappings }),
  setReview: (review) => set({ review }),
  updateReviewEntity: (id, patch) =>
    set((s) =>
      s.review
        ? {
            review: {
              ...s.review,
              entities: s.review.entities.map((e) => (e.id === id ? { ...e, ...patch } : e)),
            },
          }
        : {}
    ),
  addReviewEntity: (e) =>
    set((s) =>
      s.review ? { review: { ...s.review, entities: [...s.review.entities, e] } } : {}
    ),
  removeReviewEntity: (id) =>
    set((s) =>
      s.review
        ? { review: { ...s.review, entities: s.review.entities.filter((e) => e.id !== id) } }
        : {}
    ),
  setBusy: (busy) => set({ busy }),
  setNerAvailable: (nerAvailable) => set({ nerAvailable }),
  setProvider: (provider) => set({ provider }),
  setWebSearch: (webSearch) => set({ webSearch }),
  setNerProgress: (nerProgress) => set({ nerProgress }),
  setLocalPending: (localPending) => set({ localPending }),
  clearSession: () =>
    set({
      messages: [],
      attachments: [],
      input: '',
      runningMappings: [],
      review: null,
      localPending: null,
      nerProgress: null,
    }),
}));
