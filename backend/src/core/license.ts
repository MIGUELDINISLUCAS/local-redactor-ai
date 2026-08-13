import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';

// Raw 32-byte Ed25519 public key (base64). The matching private key lives on the
// license server (and the developer's machine) — never shipped.
const PUBLIC_KEY_B64 = 'Sstwy9wTmFnjHEuaAEi9ecrlP8jLVqi1mbB1+brXwLI=';

const PUB_KEY = crypto.createPublicKey({
  key: Buffer.concat([
    // Ed25519 SPKI header (12 bytes) + raw 32-byte key
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(PUBLIC_KEY_B64, 'base64'),
  ]),
  format: 'der',
  type: 'spki',
});

const DIR = path.join(os.homedir(), '.local-redactor');
const FILE = path.join(DIR, 'license.json');

// The ONLY outbound calls in the product: exchanging a purchase key for a
// machine-bound license, and refreshing a subscription near expiry. They carry
// the key and an anonymous machine hash — never message content.
const LICENSE_SERVER = process.env.LRA_LICENSE_SERVER ?? 'https://www.localredactor.xyz/api';

export type LicenseType = 'perpetual' | 'subscription' | 'extended-trial';

export interface LicensePayload {
  v?: number;
  email_hash: string;
  issued_at: string;
  type: LicenseType;
  expires_at: string | null;
  order_id: string;
  sub?: string;
  machine_id?: string;
}

export interface LicenseInfo {
  licensed: boolean;
  licenseType: LicenseType | null;
  licenseExpiresAt: string | null;
  machineBound: boolean;
}

// Deterrent-grade machine fingerprint: stable across restarts, changes when the
// machine genuinely differs. Not hardware attestation — a determined user can
// spoof it — but it stops a key (or a copied license.json) simply working
// everywhere, which is the actual leak we care about.
export function machineId(): string {
  let user = '';
  try { user = os.userInfo().username; } catch { /* containers without a user db */ }
  return crypto
    .createHash('sha256')
    .update(`${os.hostname()}|${user}|${os.platform()}|${os.arch()}`)
    .digest('hex')
    .slice(0, 32);
}

// Base64url helpers (no padding)
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// Verify the Ed25519 signature and return the payload, or null on any failure.
export function verifyKey(key: string): LicensePayload | null {
  try {
    const dot = key.indexOf('.');
    if (dot < 0) return null;
    const payloadBuf = b64urlDecode(key.slice(0, dot));
    const sigBuf = b64urlDecode(key.slice(dot + 1));
    const ok = crypto.verify(null, payloadBuf, PUB_KEY, sigBuf);
    if (!ok) return null;
    const parsed = JSON.parse(payloadBuf.toString('utf-8')) as LicensePayload;
    if (!parsed.type || !parsed.issued_at) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isExpired(payload: LicensePayload): boolean {
  if (!payload.expires_at) return false; // perpetual
  return Date.now() > new Date(payload.expires_at).getTime();
}

// A license is usable here when the signature holds, it hasn't expired, and —
// when machine-bound (v2) — it names THIS machine. Legacy (pre-binding) keys
// have no machine_id and stay accepted so early-beta licenses keep working.
export function usableHere(payload: LicensePayload, localMachineId: string): boolean {
  if (isExpired(payload)) return false;
  if (payload.machine_id && payload.machine_id !== localMachineId) return false;
  return true;
}

interface StoredLicense {
  key: string; // the machine license (or a legacy unbound key)
  purchaseKey?: string; // kept so subscription refresh can re-exchange
}

function saveLicense(stored: StoredLicense, payload: LicensePayload): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ ...stored, ...payload }, null, 2));
}

function deleteLicense(): void {
  try { fs.unlinkSync(FILE); } catch { /* already gone */ }
}

// Read and re-verify the stored license. Returns null if absent/invalid/expired
// or bound to a different machine.
function readLicense(): { payload: LicensePayload; key: string; purchaseKey?: string } | null {
  try {
    const stored = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as StoredLicense;
    if (!stored?.key) return null;
    const payload = verifyKey(stored.key);
    if (!payload) return null;
    if (!usableHere(payload, machineId())) return null;
    return { payload, key: stored.key, purchaseKey: stored.purchaseKey };
  } catch {
    return null;
  }
}

// Public API ---------------------------------------------------------------

export function licenseInfo(): LicenseInfo {
  const lic = readLicense();
  if (!lic) return { licensed: false, licenseType: null, licenseExpiresAt: null, machineBound: false };
  return {
    licensed: true,
    licenseType: lic.payload.type,
    licenseExpiresAt: lic.payload.expires_at,
    machineBound: !!lic.payload.machine_id,
  };
}

export interface StatusResponse extends LicenseInfo {
  // Kept for older popups that render a trial card: always reads as an ended
  // trial, which those popups show as "enter a key or buy one" — the right
  // message now that access is licensed from day one.
  trial: { startedAt: string; expiresAt: string; daysLeft: number; expired: boolean; trialDays: number };
}

export function fullStatus(): StatusResponse {
  const li = licenseInfo();
  const now = new Date().toISOString();
  return {
    ...li,
    trial: { startedAt: now, expiresAt: now, daysLeft: 0, expired: true, trialDays: 0 },
  };
}

export interface ActivationResult {
  ok: boolean;
  error?: string;
  info?: LicenseInfo;
}

// Activate a key. A machine license for THIS machine stores directly; a
// purchase key is exchanged with the license server for one (the single
// online step — subscription state lives with Stripe, not on this machine).
export async function activateLicense(rawKey: string): Promise<ActivationResult> {
  const key = rawKey.trim();
  const payload = verifyKey(key);
  if (!payload) return { ok: false, error: 'invalid-key' };
  if (isExpired(payload)) return { ok: false, error: 'key-expired' };

  const local = machineId();

  // Already bound: accept only for this machine (support/manual issuance path).
  if (payload.machine_id) {
    if (payload.machine_id !== local) return { ok: false, error: 'wrong-machine' };
    saveLicense({ key }, payload);
    return { ok: true, info: licenseInfo() };
  }

  // Legacy pre-binding keys (no v2 marker): store as-is so keys issued to the
  // first beta users keep activating without the server.
  if (!payload.v) {
    saveLicense({ key }, payload);
    return { ok: true, info: licenseInfo() };
  }

  // v2 purchase key → exchange for a machine license.
  try {
    const r = await fetch(`${LICENSE_SERVER}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, machineId: local }),
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await r.json().catch(() => null);
    if (!r.ok || !data?.ok || typeof data.license !== 'string') {
      return { ok: false, error: (data && data.error) || `activation-failed-${r.status}` };
    }
    const licPayload = verifyKey(data.license);
    if (!licPayload || !usableHere(licPayload, local)) {
      return { ok: false, error: 'server-returned-invalid-license' };
    }
    saveLicense({ key: data.license, purchaseKey: key }, licPayload);
    return { ok: true, info: licenseInfo() };
  } catch {
    return { ok: false, error: 'activation-offline' };
  }
}

export function deactivateLicense(): void {
  deleteLicense();
}

// Subscription refresh: near expiry, silently re-exchange the stored purchase
// key. Stripe decides whether the subscription still pays; if this machine is
// offline the license simply runs out at its built-in grace.
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function maybeRefreshLicense(): Promise<void> {
  const lic = readLicense();
  if (!lic || lic.payload.type !== 'subscription' || !lic.purchaseKey) return;
  if (!lic.payload.expires_at) return;
  const msLeft = new Date(lic.payload.expires_at).getTime() - Date.now();
  if (msLeft > REFRESH_WINDOW_MS) return;
  const res = await activateLicense(lic.purchaseKey);
  if (res.ok) {
    console.log('License refreshed until', licenseInfo().licenseExpiresAt);
  }
}

export function startLicenseRefreshLoop(): void {
  void maybeRefreshLicense().catch(() => {});
  setInterval(() => void maybeRefreshLicense().catch(() => {}), 12 * 60 * 60 * 1000);
}

// Express middleware: a valid license is required — there is no automatic
// trial. Free access is granted with promo keys (extended-trial), issued by
// the developer and machine-bound at activation like any other key.
export function accessGuard(_req: Request, res: Response, next: NextFunction): void {
  if (readLicense()) { next(); return; }
  res.status(403).json({ error: 'license-required' });
}
