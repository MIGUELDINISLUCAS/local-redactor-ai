#!/usr/bin/env node
// CLI: sign a license key with the developer's private key.
//
// Usage:
//   node scripts/generate-key.js --email buyer@example.com --order LS-123 --type perpetual
//   node scripts/generate-key.js --type extended-trial --days 90 --note "beta tester"
//
// The key is printed to stdout — paste it into an email to the buyer.
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign, createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
}

const type = flag('type') || 'extended-trial';
if (!['perpetual', 'subscription', 'extended-trial'].includes(type)) {
  console.error('--type must be perpetual, subscription, or extended-trial');
  process.exit(1);
}

const email = flag('email') || 'none';
const order = flag('order') || `MANUAL-${Date.now()}`;
const days = Number(flag('days') || (type === 'extended-trial' ? 90 : 0));
const note = flag('note') || '';

const privPath = join(homedir(), '.local-redactor', 'license-private.pem');
let privPem;
try {
  privPem = readFileSync(privPath, 'utf-8');
} catch {
  console.error(`Private key not found at ${privPath}`);
  console.error('Run: node scripts/generate-keypair.js');
  process.exit(1);
}

const privKey = createPrivateKey({ key: privPem, format: 'pem', type: 'pkcs8' });

const emailHash = createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 8);

const payload = {
  // v2 = purchase key: the backend exchanges it with the license server for a
  // machine-bound license at activation. Omit --legacy unless you need a key
  // that activates fully offline (pre-binding format, not machine-bound).
  ...(args.includes('--legacy') ? {} : { v: 2 }),
  email_hash: emailHash,
  issued_at: new Date().toISOString(),
  type,
  expires_at: days > 0
    ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    : null,
  order_id: order,
};

// Base64url encode (no padding)
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf-8');
const sig = sign(null, payloadBuf, privKey);
const key = b64url(payloadBuf) + '.' + b64url(sig);

console.log('License key generated:');
console.log();
console.log(key);
console.log();
console.log(`Type: ${type}`);
console.log(`Email: ${email} (hash: ${emailHash})`);
console.log(`Order: ${order}`);
if (payload.expires_at) console.log(`Expires: ${payload.expires_at.slice(0, 10)}`);
else console.log('Expires: never (perpetual)');
if (note) console.log(`Note: ${note}`);
