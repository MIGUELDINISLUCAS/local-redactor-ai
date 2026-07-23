// Copy non-TypeScript assets into dist/ after `tsc`.
//
// tsc only emits .ts → .js, so hand-written assets under src/ (notably the
// vendored ESM `gliner.mjs`, which glinerEngine dynamic-imports at runtime) never
// reach dist/. Without this the compiled build silently falls back to regex-only
// detection — `npm run dev` hides it because tsx runs straight from src/.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'src', 'vendor');
const to = path.join(root, 'dist', 'vendor');

if (!fs.existsSync(from)) {
  console.error(`✗ copy-assets: ${from} not found`);
  process.exit(1);
}
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });

// Fail loudly if the one file the runtime actually needs isn't there.
const critical = path.join(to, 'gliner', 'gliner.mjs');
if (!fs.existsSync(critical)) {
  console.error('✗ copy-assets: gliner.mjs did not reach dist/ — detection would fall back to regex only.');
  process.exit(1);
}
console.log('✓ assets copied to dist/vendor');
