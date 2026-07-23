import { Router, Request, Response } from 'express';
import { setApiKey, deleteApiKey, hasApiKey, ProviderId } from '../core/keychain';
import { callProvider, modelFor, validateApiKey } from '../core/providers';

export const providersRouter = Router();

const VALID: ProviderId[] = ['openai', 'anthropic'];

function isValid(p: any): p is ProviderId {
  return VALID.includes(p);
}

// GET /api/providers/status — which providers have a key stored, plus model ids.
providersRouter.get('/status', async (_req: Request, res: Response) => {
  res.json({
    openai: { configured: await hasApiKey('openai'), model: modelFor('openai') },
    anthropic: { configured: await hasApiKey('anthropic'), model: modelFor('anthropic') },
  });
});

// POST /api/providers/key — store an API key in the macOS Keychain.
providersRouter.post('/key', async (req: Request, res: Response) => {
  const { provider, apiKey, model } = req.body as { provider?: string; apiKey?: string; model?: string };
  if (!isValid(provider)) {
    res.status(400).json({ error: 'invalid provider' });
    return;
  }
  if (!apiKey?.trim()) {
    res.status(400).json({ error: 'apiKey is required' });
    return;
  }
  // Validate with one cheap call before storing, unless the caller opts out.
  const skipValidation = (req.body as { skipValidation?: boolean }).skipValidation === true;
  if (!skipValidation) {
    const reason = await validateApiKey(provider, apiKey.trim(), model);
    if (reason) {
      res.status(400).json({ error: reason });
      return;
    }
  }
  try {
    await setApiKey(provider, apiKey.trim());
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: `Failed to store key in Keychain: ${e.message}` });
  }
});

// DELETE /api/providers/key/:provider — remove a stored key.
providersRouter.delete('/key/:provider', async (req: Request, res: Response) => {
  const provider = req.params.provider;
  if (!isValid(provider)) {
    res.status(400).json({ error: 'invalid provider' });
    return;
  }
  await deleteApiKey(provider);
  res.json({ ok: true });
});

// POST /api/providers/complete — forward ONLY the anonymised prompt to the
// real provider and return its (still anonymised) response.
providersRouter.post('/complete', async (req: Request, res: Response) => {
  const { provider, anonymisedPrompt, model, webSearch, history } = req.body as {
    provider?: string;
    anonymisedPrompt?: string;
    model?: string;
    webSearch?: boolean;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };
  if (!isValid(provider)) {
    res.status(400).json({ error: 'invalid provider' });
    return;
  }
  if (typeof anonymisedPrompt !== 'string' || !anonymisedPrompt.trim()) {
    res.status(400).json({ error: 'anonymisedPrompt is required' });
    return;
  }
  try {
    const safeHistory = Array.isArray(history)
      ? history.filter((h) => (h?.role === 'user' || h?.role === 'assistant') && typeof h.content === 'string')
      : [];
    const output = await callProvider(provider, anonymisedPrompt, { model, webSearch, history: safeHistory });
    res.json({ output, model: model?.trim() || modelFor(provider) });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});
