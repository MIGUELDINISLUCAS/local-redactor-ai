// Shared crypto + Stripe helpers for the license endpoints.
//
// The Ed25519 PRIVATE key lives only in the Vercel env (LICENSE_PRIVATE_KEY,
// PEM). Its public half is embedded in every shipped backend, so licenses
// signed here validate fully offline on the user's machine.
//
// Two token shapes, same signature scheme:
//  - PURCHASE KEY   {v:2, type, email_hash, issued_at, order_id, sub?}
//      what the buyer receives (from /api/claim after Stripe checkout, or a
//      promo key generated with scripts/generate-key.js). Not machine-bound.
//  - MACHINE LICENSE {…same, machine_id, expires_at}
//      what /api/activate returns for one specific machine. This is what the
//      backend stores and verifies offline.
import crypto from 'crypto';

export function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function privateKey(): crypto.KeyObject {
  const raw = process.env.LICENSE_PRIVATE_KEY;
  if (!raw) throw new Error('LICENSE_PRIVATE_KEY not configured');
  // Accept the PEM directly OR base64 of it. A PEM is multi-line, and env
  // plumbing (shells, dashboards, CI) mangles newlines in assorted ways —
  // base64 is a single line and sidesteps the whole problem. Literal "\n"
  // escapes are also repaired, since some UIs store them that way.
  const pem = (raw.includes('BEGIN') ? raw : Buffer.from(raw.trim(), 'base64').toString('utf-8'))
    .replace(/\\n/g, '\n')
    .trim();
  return crypto.createPrivateKey({ key: pem, format: 'pem' });
}

export function signPayload(payload: Record<string, unknown>): string {
  const buf = Buffer.from(JSON.stringify(payload), 'utf-8');
  const sig = crypto.sign(null, buf, privateKey());
  return `${b64url(buf)}.${b64url(sig)}`;
}

// Verify with the PUBLIC key (same value the backends embed) so this code
// never trusts an unsigned payload even server-side.
const PUBLIC_KEY_B64 = 'Sstwy9wTmFnjHEuaAEi9ecrlP8jLVqi1mbB1+brXwLI=';
const PUB = crypto.createPublicKey({
  key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(PUBLIC_KEY_B64, 'base64'),
  ]),
  format: 'der',
  type: 'spki',
});

export function verifyKey(key: string): Record<string, any> | null {
  try {
    const dot = key.indexOf('.');
    if (dot < 0) return null;
    const payloadBuf = b64urlDecode(key.slice(0, dot));
    const sigBuf = b64urlDecode(key.slice(dot + 1));
    if (!crypto.verify(null, payloadBuf, PUB, sigBuf)) return null;
    return JSON.parse(payloadBuf.toString('utf-8'));
  } catch {
    return null;
  }
}

export function emailHash(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 8);
}

// Minimal Stripe REST client — a bare fetch keeps the functions dependency-free.
export async function stripeGet(path: string): Promise<any> {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) throw new Error('STRIPE_SECRET_KEY not configured');
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${sk}` },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`stripe ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}
