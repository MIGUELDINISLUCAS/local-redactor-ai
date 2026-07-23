import type { SensitiveEntity, PlaceholderMapping, FileMetadata, RestorationWarning } from '../types';

const BASE = '/api';

// Parse a response body as JSON, tolerating empty/non-JSON bodies (e.g. when the
// local backend is down and the dev proxy returns an empty error page).
async function parseJson<T>(res: Response): Promise<T | null> {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Shared request helper: clear errors instead of "Unexpected end of JSON input".
async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new Error(
      'Cannot reach the local backend. Make sure it is running (npm run dev in /backend, port 3001).'
    );
  }

  const body = await parseJson<any>(res);
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status}). Is the local backend running?`);
  }
  if (body === null) {
    throw new Error('The local backend returned an empty response. Check that it is running on port 3001.');
  }
  return body as T;
}

function jsonInit(payload: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

export function detectFromText(text: string): Promise<{
  entities: SensitiveEntity[];
  mappings: PlaceholderMapping[];
}> {
  return request('/text', jsonInit({ text }));
}

// Parse-only: extract text + metadata. Detection happens later on send/review.
export function detectFromFile(file: File): Promise<{
  fileMetadata: FileMetadata;
  extractedText: string;
}> {
  const fd = new FormData();
  fd.append('file', file);
  return request('/file', { method: 'POST', body: fd });
}

export interface CustomRule {
  pattern: string;
  category: string;
  isRegex: boolean;
}

export function processText(
  text: string,
  priorMappings: PlaceholderMapping[],
  customRules: CustomRule[] = []
): Promise<{ anonymisedText: string; entities: SensitiveEntity[]; mappings: PlaceholderMapping[]; nerUsed: boolean; nerPartial: boolean }> {
  return request('/process', jsonInit({ text, priorMappings, customRules }));
}

export interface ProcessResult {
  anonymisedText: string;
  entities: SensitiveEntity[];
  mappings: PlaceholderMapping[];
  nerUsed: boolean;
  nerPartial: boolean;
}

// Like processText, but reads Server-Sent Events so the caller can show a
// progress bar while the local model scans each chunk.
export async function processTextStream(
  text: string,
  priorMappings: PlaceholderMapping[],
  customRules: CustomRule[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<ProcessResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/process-stream`, { ...jsonInit({ text, priorMappings, customRules }), signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('Cannot reach the local backend. Make sure it is running (port 3001).');
  }
  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(body || `Request failed (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: ProcessResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!line.startsWith('data:')) continue;
      const obj = JSON.parse(line.slice(5).trim());
      if (obj.type === 'progress') onProgress(obj.done, obj.total);
      else if (obj.type === 'result') final = obj as ProcessResult;
      else if (obj.type === 'error') throw new Error(obj.error);
    }
  }
  if (!final) throw new Error('The local backend ended the stream without a result.');
  return final;
}

export function nerStatus(): Promise<{ available: boolean }> {
  return request('/ner-status', { method: 'GET' });
}

export type ProviderId = 'openai' | 'anthropic';

export interface ProvidersStatus {
  openai: { configured: boolean; model: string };
  anthropic: { configured: boolean; model: string };
}

export function providersStatus(): Promise<ProvidersStatus> {
  return request('/providers/status', { method: 'GET' });
}

export function saveProviderKey(provider: ProviderId, apiKey: string, model?: string): Promise<{ ok: boolean }> {
  return request('/providers/key', jsonInit({ provider, apiKey, model }));
}

export function deleteProviderKey(provider: ProviderId): Promise<{ ok: boolean }> {
  return request(`/providers/key/${provider}`, { method: 'DELETE' });
}

// Sends ONLY the anonymised prompt to the real provider via the local backend.
export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function providerComplete(
  provider: ProviderId,
  anonymisedPrompt: string,
  model?: string,
  webSearch?: boolean,
  history?: HistoryTurn[]
): Promise<{ output: string; model: string }> {
  return request('/providers/complete', jsonInit({ provider, anonymisedPrompt, model, webSearch, history }));
}

async function triggerDownload(res: Response, filename: string): Promise<void> {
  if (!res.ok) throw new Error('Failed to generate DOCX. Is the local backend running?');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Download plain text as a .docx file, generated locally by the backend.
export async function downloadDocx(text: string, filename: string): Promise<void> {
  const res = await fetch('/api/export/docx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, filename }),
  });
  await triggerDownload(res, filename);
}

export interface DocxSection {
  heading: string;
  body: string;
}

// Download a structured audit record (headed sections) as a .docx.
export async function downloadRecord(
  title: string,
  sections: DocxSection[],
  filename: string
): Promise<void> {
  const res = await fetch('/api/export/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, sections, filename }),
  });
  await triggerDownload(res, filename);
}

export function anonymise(
  text: string,
  entities: SensitiveEntity[],
  priorMappings: PlaceholderMapping[] = []
): Promise<{ anonymisedText: string; mappings: PlaceholderMapping[] }> {
  return request('/anonymise', jsonInit({ text, entities, priorMappings }));
}

// Mock LLM provider. In production this would call a real configured provider
// with ONLY the anonymised text. Lives client-side so v0.1 makes no real
// external calls.
export async function mockProvider(anonymisedPrompt: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 900));
  return `[MOCK LLM RESPONSE]\n\nI received your anonymised request and here is a draft reply that references the same placeholders so they can be restored locally:\n\n${anonymisedPrompt
    .split('\n')
    .slice(0, 3)
    .join('\n')}\n\n(This is a mock response. Connect a real provider in a later version.)`;
}

export function restore(
  anonymisedText: string,
  mappings: PlaceholderMapping[]
): Promise<{
  restoredText: string;
  warnings: RestorationWarning[];
  restoredCount: number;
  unresolvedCount: number;
}> {
  return request('/restore', jsonInit({ anonymisedText, mappings }));
}
