import { Router, Request, Response } from 'express';
import { upload } from '../middleware/upload';
import { parseFile } from '../parsers/parseFile';
import { detectAll } from '../core/detect';
import { isOllamaAvailable, thoroughModelInstalled, glinerModelReady } from '../core/nerDetector';
import { glinerLoadError } from '../core/glinerEngine';
import { createRegistry, registerEntities, getAllMappings, seedRegistry } from '../core/placeholderRegistry';
import { applyContextDefaults } from '../core/contextTerms';
import { anonymiseText } from '../core/anonymise';
import { restoreText } from '../core/restore';

export const detectRouter = Router();

// The fast GLiNER engine is the default. The `thorough` flag opts into the
// accurate Ollama 4B Anonymizer for a deeper check. Engine selection happens
// inside detectAll → detectWithNer; routes just forward the flag.

// GET /api/ner-status — which detection engines are available?
//  - fast:      the bundled in-process GLiNER model (the product's default)
//  - thorough:  the OPTIONAL self-installed Ollama model (may be absent)
//  - available: legacy field — true if fast detection can run at all
//  - loadError: why the model failed to load, when it did
//
// `fast` reports whether the model can actually be USED, not merely that the
// file is on disk: a model that is present but fails to load reported fast:true
// while detection silently ran regex-only, which made that failure very hard to
// diagnose. loadError carries the reason so the UI can show it.
detectRouter.get('/ner-status', async (_req: Request, res: Response) => {
  const loadError = glinerLoadError();
  const fast = glinerModelReady() && !loadError;
  const thorough = await thoroughModelInstalled();
  res.json({
    available: fast || (await isOllamaAvailable()),
    fast,
    thorough,
    modelPresent: glinerModelReady(),
    ...(loadError ? { loadError } : {}),
  });
});

// POST /api/process — detect + anonymise in one call, continuing from prior
// mappings so placeholders stay stable across chat turns.
detectRouter.post('/process', async (req: Request, res: Response) => {
  const { text, priorMappings = [], customRules = [], thorough, ignore = [] } = req.body as {
    text?: string;
    priorMappings?: Array<{ placeholder: string; originalValue: string; category: any }>;
    customRules?: Array<{ pattern: string; category: any; isRegex?: boolean }>;
    thorough?: boolean;
    ignore?: string[];
  };
  if (!text?.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const registry = createRegistry();
  seedRegistry(registry, priorMappings);
  const { entities: raw, nerUsed, nerPartial, nerEngine } = await detectAll(text, { customRules, thorough, ignore });
  const entities = applyContextDefaults(registerEntities(registry, raw), text);
  const result = anonymiseText(text, entities, registry);
  if (result.unreplaced?.length) {
    // Fail safe: a value the user ticked survived anonymisation. Returning the
    // text would leak it while the UI reports it as protected — refuse instead.
    res.status(500).json({ error: 'anonymisation-incomplete', unreplacedCount: result.unreplaced.length });
    return;
  }
  res.json({
    anonymisedText: result.anonymisedText,
    entities,
    mappings: getAllMappings(registry),
    nerUsed,
    nerPartial,
    nerEngine,
  });
});

// POST /api/process-stream — same as /process but streams NER progress over SSE
// so the UI can show a progress bar while the local model scans each chunk.
detectRouter.post('/process-stream', async (req: Request, res: Response) => {
  const { text, priorMappings = [], customRules = [], thorough, ignore = [] } = req.body as {
    text?: string;
    priorMappings?: Array<{ placeholder: string; originalValue: string; category: any }>;
    customRules?: Array<{ pattern: string; category: any; isRegex?: boolean }>;
    thorough?: boolean;
    ignore?: string[];
  };
  if (!text?.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (obj: unknown) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  // Cancel detection (stop launching/abort model calls) if the client
  // disconnects mid-stream — e.g. the user pressed Stop. Use res 'close' (fires
  // on real disconnect) guarded by `finished`, NOT req 'close' (which Node
  // fires as soon as the request body is consumed, spuriously aborting).
  const controller = new AbortController();
  let finished = false;
  res.on('close', () => {
    if (!finished) controller.abort();
  });

  try {
    const registry = createRegistry();
    seedRegistry(registry, priorMappings);
    const { entities: raw, nerUsed, nerPartial, nerEngine } = await detectAll(text, {
      customRules,
      thorough,
      ignore,
      signal: controller.signal,
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    });
    const entities = applyContextDefaults(registerEntities(registry, raw), text);
    const result = anonymiseText(text, entities, registry);
    if (result.unreplaced?.length) {
      // Fail safe — see /process. Never emit text that still carries a ticked value.
      send({ type: 'error', error: 'anonymisation-incomplete' });
      return;
    }
    send({
      type: 'result',
      anonymisedText: result.anonymisedText,
      entities,
      mappings: getAllMappings(registry),
      nerUsed,
      nerPartial,
      nerEngine,
    });
  } catch (e: any) {
    if (e?.name !== 'AbortError') send({ type: 'error', error: e?.message ?? 'detection failed' });
  } finally {
    finished = true;
    if (!res.writableEnded) res.end();
  }
});

// POST /api/detect — detect from pasted text
detectRouter.post('/text', async (req: Request, res: Response) => {
  const { text, customRules = [] } = req.body as {
    text?: string;
    customRules?: Array<{ pattern: string; category: any; isRegex?: boolean }>;
  };
  if (!text?.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const { entities: raw, nerUsed } = await detectAll(text, { customRules });
  const registry = createRegistry();
  const entities = applyContextDefaults(registerEntities(registry, raw), text);
  res.json({ entities, mappings: getAllMappings(registry), nerUsed });
});

// POST /api/detect/file — upload and detect from file
detectRouter.post('/file', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'file is required' });
    return;
  }
  try {
    // Parse-only: just extract text + metadata. Detection (regex + the slow
    // local NER) runs later when the user sends/reviews, with a progress bar —
    // not at attach time, which would block the upload for minutes.
    const parsed = await parseFile(req.file.path, req.file.mimetype, req.file.originalname);
    res.json({
      fileMetadata: {
        filename: parsed.filename,
        fileType: parsed.fileType,
        wordCount: parsed.wordCount,
        warnings: parsed.warnings,
      },
      extractedText: parsed.text,
    });
  } catch (err: any) {
    res.status(422).json({ error: err.message });
  }
});

// POST /api/anonymise — anonymise text given entities + inclusions
detectRouter.post('/anonymise', (req: Request, res: Response) => {
  const { text, entities, priorMappings = [] } = req.body as {
    text?: string;
    entities?: any[];
    priorMappings?: Array<{ placeholder: string; originalValue: string; category: any }>;
  };
  if (!text || !entities) {
    res.status(400).json({ error: 'text and entities are required' });
    return;
  }
  const registry = createRegistry();
  // Carry over placeholders from earlier turns so the running map is complete.
  seedRegistry(registry, priorMappings);
  // Re-populate registry from provided entities so placeholders are stable.
  for (const e of entities) {
    if (e.include !== false) {
      registry.entries.set(e.placeholder, {
        placeholder: e.placeholder,
        originalValue: e.originalValue,
        category: e.category,
      });
      registry.byValue.set(e.originalValue, e.placeholder);
    }
  }
  const result = anonymiseText(text, entities, registry);
  res.json({ ...result, mappings: getAllMappings(registry) });
});

// POST /api/restore — restore anonymised output
detectRouter.post('/restore', (req: Request, res: Response) => {
  const { anonymisedText, mappings } = req.body as {
    anonymisedText?: string;
    mappings?: Array<{ placeholder: string; originalValue: string; category: string }>;
  };
  if (!anonymisedText || !mappings) {
    res.status(400).json({ error: 'anonymisedText and mappings are required' });
    return;
  }
  const registry = createRegistry();
  for (const m of mappings) {
    registry.entries.set(m.placeholder, {
      placeholder: m.placeholder,
      originalValue: m.originalValue,
      category: m.category as any,
    });
    registry.byValue.set(m.originalValue, m.placeholder);
  }
  const result = restoreText(anonymisedText, registry);
  res.json(result);
});
