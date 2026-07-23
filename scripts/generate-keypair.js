#!/usr/bin/env node
// One-time: generate an Ed25519 keypair for offline license signing.
// The PRIVATE key goes to ~/.local-redactor/license-private.pem (never shipped).
// The PUBLIC key is printed as a base64 string — embed it in license.ts.
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const dir = join(homedir(), '.local-redactor');
const privPath = join(dir, 'license-private.pem');

if (existsSync(privPath)) {
  console.error(`Private key already exists at ${privPath}`);
  console.error('Delete it first if you really want to regenerate (this invalidates ALL existing keys).');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

mkdirSync(dir, { recursive: true });
writeFileSync(privPath, privateKey, { mode: 0o600 });

// Extract the raw 32-byte public key from the PEM/SPKI wrapper for embedding.
const spkiDer = Buffer.from(
  publicKey.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, ''),
  'base64'
);
// Ed25519 SPKI is always 44 bytes: 12-byte header + 32-byte key.
const rawPub = spkiDer.subarray(12);
const pubB64 = rawPub.toString('base64');

console.log('Ed25519 keypair generated.');
console.log(`Private key saved to: ${privPath}`);
console.log();
console.log('Embed this PUBLIC KEY in backend/src/core/license.ts:');
console.log(`  const PUBLIC_KEY_B64 = '${pubB64}';`);
