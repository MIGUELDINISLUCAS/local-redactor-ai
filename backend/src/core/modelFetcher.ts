import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// First-run model download. The GLiNER weights (~1.6GB) are no longer bundled in
// the installer — that made every release a 1.8GB upload and the Windows NSIS
// unpack unreliable. Instead the app ships small (~290MB) and fetches the model
// once, into a WRITABLE user-data folder (the app bundle itself is read-only and
// code-signed, so the model cannot live inside it). The small tokenizer/config
// files are still bundled and copied alongside it.
//
// The model is treated as a managed cache, verified by size + SHA-256 on every
// launch: if it is missing, truncated or corrupt, it is re-downloaded. So a user
// deleting it, or a half-finished download, self-heals rather than silently
// degrading to regex-only (the failure mode that was previously invisible).

export type ModelPhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'ready' | 'error';

export interface ModelStatus {
  phase: ModelPhase;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
}

const status: ModelStatus = { phase: 'idle', downloadedBytes: 0, totalBytes: 0, error: null };
export function modelStatus(): ModelStatus {
  return { ...status };
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

// A present file counts as valid if its size matches (fast path) and, when a
// checksum is configured, its SHA-256 matches too.
async function isValid(file: string, expectedSize: number, expectedSha: string): Promise<boolean> {
  try {
    const st = fs.statSync(file);
    if (expectedSize && st.size !== expectedSize) return false;
    if (!expectedSha) return true;
    return (await sha256File(file)) === expectedSha.toLowerCase();
  } catch {
    return false;
  }
}

// Copy the bundled tokenizer/config files into the writable model dir if they are
// not already there. These are small and ship inside the app; only model.onnx is
// downloaded.
function seedBundledFiles(bundledDir: string, targetDir: string): void {
  if (!bundledDir || !fs.existsSync(bundledDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of fs.readdirSync(bundledDir)) {
    if (name === 'model.onnx') continue; // the big file is fetched, not copied
    const src = path.join(bundledDir, name);
    const dst = path.join(targetDir, name);
    try {
      if (fs.statSync(src).isFile() && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    } catch { /* best effort */ }
  }
}

async function download(url: string, dest: string, expectedSha: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  status.totalBytes = Number(res.headers.get('content-length')) || status.totalBytes;
  status.downloadedBytes = 0;

  const tmp = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(tmp);
  const hash = crypto.createHash('sha256');
  try {
    // @ts-ignore — Node 18+ web ReadableStream is async-iterable at runtime.
    for await (const chunk of res.body as any) {
      out.write(chunk);
      hash.update(chunk);
      status.downloadedBytes += chunk.length;
    }
    await new Promise<void>((r, j) => out.end((e: any) => (e ? j(e) : r())));
  } catch (e) {
    out.destroy();
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }

  if (expectedSha && hash.digest('hex') !== expectedSha.toLowerCase()) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error('checksum mismatch — download was corrupted');
  }
  fs.renameSync(tmp, dest); // atomic: model.onnx only appears once complete + verified
}

// Ensure model.onnx exists and is valid in `dir`, downloading it if not. Safe to
// call unconditionally: with no GLINER_MODEL_URL (dev, or a bundled build) it
// only verifies what is on disk and never reaches the network.
export async function ensureModel(opts: {
  dir: string;
  url?: string;
  sha256?: string;
  size?: number;
  bundledDir?: string;
}): Promise<boolean> {
  const { dir, url, sha256 = '', size = 0, bundledDir = '' } = opts;
  const target = path.join(dir, 'model.onnx');
  try {
    seedBundledFiles(bundledDir, dir);

    status.phase = 'checking';
    if (await isValid(target, size, sha256)) { status.phase = 'ready'; return true; }

    // No URL to fetch from → nothing more we can do (dev uses an on-disk model).
    if (!url) {
      status.phase = fs.existsSync(target) ? 'ready' : 'error';
      if (status.phase === 'error') status.error = 'model not present and no download source';
      return status.phase === 'ready';
    }

    status.phase = 'downloading';
    status.error = null;
    console.log(`Downloading GLiNER model (~${size ? Math.round(size / 1e6) : '?'}MB) → ${target}`);
    await download(url, target, sha256);

    status.phase = 'verifying';
    if (!(await isValid(target, size, sha256))) throw new Error('post-download validation failed');

    status.phase = 'ready';
    console.log('GLiNER model ready.');
    return true;
  } catch (e) {
    status.phase = 'error';
    status.error = e instanceof Error ? e.message : String(e);
    console.log('GLiNER model download failed:', status.error);
    return false;
  }
}
