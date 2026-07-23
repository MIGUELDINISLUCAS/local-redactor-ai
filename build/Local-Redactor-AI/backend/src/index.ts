import express from 'express';
import cors from 'cors';
import path from 'path';
import { detectRouter } from './routes/detect';
import { exportRouter } from './routes/export';
import { providersRouter } from './routes/providers';
import { warmUpNer } from './core/nerDetector';
import { trialStatus } from './core/trial';
import { accessGuard, fullStatus } from './core/license';
import licenseRouter from './routes/license';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl/native clients do not send a browser Origin
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return url.port === String(PORT) || url.port === '5173';
    }
    // Extension IDs vary for unpacked beta installs. Packaged releases should set
    // LRA_EXTENSION_IDS to a comma-separated allow-list of their stable IDs.
    if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
      const allowed = (process.env.LRA_EXTENSION_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return allowed.length === 0 || allowed.includes(url.hostname);
    }
  } catch {
    return false;
  }
  return false;
}

// Allow the known local web-app origins and browser extensions (the
// ChatGPT/Claude companion). We deliberately reject arbitrary websites since
// /providers/complete can spend the user's API key.
app.use(
  cors({
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) cb(null, true);
      else cb(new Error('Origin not allowed'));
    },
  })
);
app.use(express.json({ limit: '10mb' }));

// Status + license activation are always readable (the popup needs them even
// after the trial expires). /health too. The guard blocks all other /api work
// once both trial and license are exhausted.
app.get('/api/trial', (_req, res) => res.json(trialStatus()));
app.use('/api', licenseRouter);
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', privacy: 'local-only', ...fullStatus() })
);
app.use('/api', accessGuard);

app.use('/api', detectRouter);
app.use('/api/export', exportRouter);
app.use('/api/providers', providersRouter);

// Desktop/production: serve the built React frontend from this same server so
// the whole app lives on one local origin (no external hosting, no CORS).
if (process.env.SERVE_STATIC === '1' && process.env.FRONTEND_DIST) {
  const dist = process.env.FRONTEND_DIST;
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Local Redactor AI backend running on http://${HOST}:${PORT}`);
  console.log('No telemetry. No analytics. No external calls.');
  const s = fullStatus();
  if (s.licensed) {
    console.log(`License: ${s.licenseType}${s.licenseExpiresAt ? ` (expires ${s.licenseExpiresAt.slice(0, 10)})` : ''}`);
  } else {
    console.log(
      s.trial.expired
        ? '⚠ Trial expired — detection is disabled until a licence is added.'
        : `Trial: ${s.trial.daysLeft} day(s) left (of ${s.trial.trialDays}).`
    );
  }
  // Warm the local NER model in the background (no-op if Ollama is absent).
  void warmUpNer();
});

// Fail with a plain-English message instead of a raw stack trace when the port
// is already taken — the single most common first-run snag for new users. The
// extension talks to a fixed port (localhost:3001), so we can't silently switch.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n✗ Port ${PORT} is already in use by another app.\n` +
        `  Local Redactor AI needs port ${PORT}, and the extension only looks there.\n` +
        `  Fix: quit whatever is using it (or just restart your computer), then run setup again.\n` +
        `  To see what's using it — macOS/Linux: lsof -i :${PORT}   ·   Windows: netstat -ano | findstr :${PORT}\n`
    );
  } else {
    console.error('✗ Backend failed to start:', err.message);
  }
  process.exit(1);
});
