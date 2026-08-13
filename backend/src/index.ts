import express from 'express';
import cors from 'cors';
import path from 'path';
import { detectRouter } from './routes/detect';
import { warmUpNer } from './core/nerDetector';
import { accessGuard, fullStatus, startLicenseRefreshLoop } from './core/license';
import licenseRouter from './routes/license';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

// The published Chrome Web Store extension. LRA_EXTENSION_IDS extends this
// list (comma-separated) for unpacked/beta installs whose IDs differ.
const DEFAULT_EXTENSION_IDS = ['dppllhhednkmbcchgldbbnaedfaidgpj'];

function allowedExtensionIds(): string[] {
  const extra = (process.env.LRA_EXTENSION_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_EXTENSION_IDS, ...extra];
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl/native clients do not send a browser Origin
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return url.port === String(PORT) || url.port === '5173';
    }
    if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
      return allowedExtensionIds().includes(url.hostname);
    }
  } catch {
    return false;
  }
  return false;
}

// DNS-rebinding guard: a malicious site can point its own domain at 127.0.0.1
// and reach this server as a "same-origin" request that CORS never sees. Such
// requests still carry the attacker's domain in the Host header — reject any
// Host that isn't a local one.
app.use((req, res, next) => {
  const host = (req.headers.host ?? '').toLowerCase();
  const hostname = host.replace(/:\d+$/, '');
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    next();
    return;
  }
  res.status(403).json({ error: 'forbidden-host' });
});

// Allow the known local web-app origins and browser extensions (the
// ChatGPT/Claude companion). We deliberately reject arbitrary websites so a
// random page can't reach the local anonymisation engine.
app.use(
  cors({
    origin: (origin, cb) => {
      // Disallowed origins get no CORS headers (browser blocks the response)
      // rather than an error, which would 500 with a stack trace.
      cb(null, isAllowedOrigin(origin));
    },
  })
);
app.use(express.json({ limit: '10mb' }));

// Status + license activation are always readable (the popup needs them even
// when unlicensed). /health too. The guard blocks all other /api work until a
// license is active. /api/trial stays as a shim for older popups.
app.get('/api/trial', (_req, res) => res.json(fullStatus().trial));
app.use('/api', licenseRouter);
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', privacy: 'local-only', ...fullStatus() })
);
app.use('/api', accessGuard);

app.use('/api', detectRouter);

// Desktop/production: serve the built React frontend from this same server so
// the whole app lives on one local origin (no external hosting, no CORS).
if (process.env.SERVE_STATIC === '1' && process.env.FRONTEND_DIST) {
  const dist = process.env.FRONTEND_DIST;
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Local Redactor AI backend running on http://${HOST}:${PORT}`);
  console.log('No telemetry. No analytics. Message content never leaves this device.');
  const s = fullStatus();
  if (s.licensed) {
    console.log(`License: ${s.licenseType}${s.machineBound ? ' (machine-bound)' : ''}${s.licenseExpiresAt ? ` — expires ${s.licenseExpiresAt.slice(0, 10)}` : ''}`);
  } else {
    console.log('⚠ No license — detection is disabled until a key is activated in the extension popup.');
  }
  // Subscription licenses re-exchange near expiry (the product's only network
  // call, carrying the key + machine hash only).
  startLicenseRefreshLoop();
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
