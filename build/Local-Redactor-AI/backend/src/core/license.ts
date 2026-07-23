import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import { trialStatus } from './trial';

// Raw 32-byte Ed25519 public key (base64). The matching private key lives on the
// developer's machine at ~/.local-redactor/license-private.pem — never shipped.
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

export type LicenseType = 'perpetual' | 'subscription' | 'extended-trial';

export interface LicensePayload {
  email_hash: string;
  issued_at: string;
  type: LicenseType;
  expires_at: string | null;
  order_id: string;
}

export interface LicenseInfo {
  licensed: boolean;
  licenseType: LicenseType | null;
  licenseExpiresAt: string | null;
}

// Base64url helpers (no padding)
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// Verify the Ed25519 signature and return the payload, or null on any failure.
function verifyKey(key: string): LicensePayload | null {
  try {
    const dot = key.indexOf('.');
    if (dot < 0) return null;
    const payloadB64 = key.slice(0, dot);
    const sigB64 = key.slice(dot + 1);
    const payloadBuf = b64urlDecode(payloadB64);
    const sigBuf = b64urlDecode(sigB64);
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

// Persist a validated key so it survives backend restarts.
function saveLicense(key: string, payload: LicensePayload): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ key, ...payload }, null, 2));
}

function deleteLicense(): void {
  try { fs.unlinkSync(FILE); } catch { /* already gone */ }
}

// Read and re-verify the stored license. Returns null if absent/invalid/expired.
function readLicense(): { payload: LicensePayload; key: string } | null {
  try {
    const stored = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    if (!stored?.key) return null;
    const payload = verifyKey(stored.key);
    if (!payload) return null;
    if (isExpired(payload)) return null;
    return { payload, key: stored.key };
  } catch {
    return null;
  }
}

// Public API ---------------------------------------------------------------

export function licenseInfo(): LicenseInfo {
  const lic = readLicense();
  if (!lic) return { licensed: false, licenseType: null, licenseExpiresAt: null };
  return {
    licensed: true,
    licenseType: lic.payload.type,
    licenseExpiresAt: lic.payload.expires_at,
  };
}

export interface StatusResponse {
  licensed: boolean;
  licenseType: LicenseType | null;
  licenseExpiresAt: string | null;
  trial: ReturnType<typeof trialStatus>;
}

export function fullStatus(): StatusResponse {
  const li = licenseInfo();
  const trial = trialStatus();
  // An extended-trial key overrides the built-in trial countdown.
  if (li.licensed && li.licenseType === 'extended-trial' && li.licenseExpiresAt) {
    const expiresMs = new Date(li.licenseExpiresAt).getTime();
    const daysLeft = Math.max(0, Math.ceil((expiresMs - Date.now()) / (24 * 60 * 60 * 1000)));
    trial.daysLeft = daysLeft;
    trial.expired = daysLeft <= 0;
    trial.expiresAt = li.licenseExpiresAt;
  }
  return { ...li, trial };
}

export function activateLicense(key: string): { ok: boolean; error?: string; info?: LicenseInfo } {
  const payload = verifyKey(key.trim());
  if (!payload) return { ok: false, error: 'invalid-key' };
  if (isExpired(payload)) return { ok: false, error: 'key-expired' };
  saveLicense(key.trim(), payload);
  return { ok: true, info: licenseInfo() };
}

export function deactivateLicense(): void {
  deleteLicense();
}

// Express middleware: licensed users pass freely; otherwise fall back to trial.
export function accessGuard(_req: Request, res: Response, next: NextFunction): void {
  const lic = readLicense();
  if (lic) { next(); return; }
  const s = trialStatus();
  if (!s.expired) { next(); return; }
  res.status(403).json({ error: 'trial-expired', expiresAt: s.expiresAt, trialDays: s.trialDays });
}
