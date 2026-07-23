import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getApiKey, ProviderId } from './keychain';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.5';

const SYSTEM_NOTE =
  'You are assisting via a privacy tool. The user text contains placeholders like ' +
  '[PERSON_001] or [EMAIL_001] that stand in for redacted sensitive values. ' +
  'Treat each placeholder as an opaque token: keep it byte-for-byte identical in your ' +
  'response, do not invent real values for them, and do not comment on the redaction.';

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string; // already anonymised (placeholders only)
}

export interface ProviderOptions {
  model?: string;
  webSearch?: boolean;
  // Prior conversation turns, ANONYMISED, so the model has memory across turns.
  history?: HistoryTurn[];
}

// Send ONLY the anonymised prompt to the real provider and return its (still
// anonymised) response. The local re-identification map is never passed here.
// With `webSearch`, the provider's server-side web-search tool is enabled — the
// model's queries are derived from the (already anonymised) prompt.
export async function callProvider(
  provider: ProviderId,
  anonymisedPrompt: string,
  opts: ProviderOptions = {}
): Promise<string> {
  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider}. Add one in Settings.`);
  }
  return provider === 'anthropic'
    ? callAnthropic(apiKey, anonymisedPrompt, opts)
    : callOpenAI(apiKey, anonymisedPrompt, opts);
}

async function callAnthropic(apiKey: string, prompt: string, opts: ProviderOptions): Promise<string> {
  const client = new Anthropic({ apiKey });
  const model = opts.model?.trim() || ANTHROPIC_MODEL;
  // Server-side web search with citations (Claude runs the search loop).
  const tools = opts.webSearch
    ? ([{ type: 'web_search_20260209', name: 'web_search' }] as any)
    : undefined;
  const messages: Anthropic.MessageParam[] = [
    ...(opts.history ?? []).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: prompt },
  ];

  let resp = await client.messages.create({
    model, max_tokens: 8192, system: SYSTEM_NOTE, tools, messages,
  });
  // The server-side search loop may pause; resume until it finishes.
  let guard = 0;
  while (resp.stop_reason === 'pause_turn' && guard++ < 5) {
    messages.push({ role: 'assistant', content: resp.content });
    resp = await client.messages.create({ model, max_tokens: 8192, system: SYSTEM_NOTE, tools, messages });
  }

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return appendSources(text, collectAnthropicSources(resp.content));
}

async function callOpenAI(apiKey: string, prompt: string, opts: ProviderOptions): Promise<string> {
  const client = new OpenAI({ apiKey });
  const model = opts.model?.trim() || OPENAI_MODEL;

  const history = opts.history ?? [];

  if (opts.webSearch) {
    // Responses API with the web_search tool.
    const resp = await client.responses.create({
      model,
      tools: [{ type: 'web_search' }] as any,
      input: [
        { role: 'system', content: SYSTEM_NOTE },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: prompt },
      ],
    });
    return appendSources(resp.output_text ?? '', collectOpenAISources(resp));
  }

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_NOTE },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: prompt },
    ],
  });
  return resp.choices[0]?.message?.content ?? '';
}

// --- citation extraction (best-effort; shapes vary across SDK versions) ---
function collectAnthropicSources(content: any[]): Map<string, string> {
  const urls = new Map<string, string>();
  for (const block of content) {
    for (const c of block?.citations ?? []) {
      if (c?.url) urls.set(c.url, c.title || c.url);
    }
  }
  return urls;
}

function collectOpenAISources(resp: any): Map<string, string> {
  const urls = new Map<string, string>();
  for (const item of resp?.output ?? []) {
    for (const part of item?.content ?? []) {
      for (const a of part?.annotations ?? []) {
        if (a?.url) urls.set(a.url, a.title || a.url);
      }
    }
  }
  return urls;
}

function appendSources(text: string, urls: Map<string, string>): string {
  if (urls.size === 0) return text;
  const list = [...urls].map(([url, title]) => `- ${title} (${url})`).join('\n');
  return `${text}\n\nSources:\n${list}`;
}

export function modelFor(provider: ProviderId): string {
  return provider === 'anthropic' ? ANTHROPIC_MODEL : OPENAI_MODEL;
}

// Make the cheapest possible call to confirm a key is valid and authorized.
// Returns null on success, or a short human-readable reason on failure.
export async function validateApiKey(
  provider: ProviderId,
  apiKey: string,
  model?: string
): Promise<string | null> {
  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: model?.trim() || ANTHROPIC_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
    } else {
      const client = new OpenAI({ apiKey });
      await client.chat.completions.create({
        model: model?.trim() || OPENAI_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
    }
    return null;
  } catch (e: any) {
    const status = e?.status;
    if (status === 401) return 'Key was rejected (invalid or revoked).';
    if (status === 403) return 'Key lacks permission for this model.';
    if (status === 429) return 'Rate limited — key works but is over quota.';
    if (status === 400 || status === 402) {
      return e?.message?.includes('credit') || e?.message?.includes('billing')
        ? 'Key is valid but the account has no credits/billing set up.'
        : (e?.message ?? 'Validation failed.');
    }
    return e?.message ?? 'Could not validate key (network or provider error).';
  }
}
