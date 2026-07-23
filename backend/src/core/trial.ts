import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Time-limited trial. The clock starts on first run and lasts TRIAL_DAYS. The
// start date is stored in the user's home dir and HMAC-signed so it can't be
// trivially edited to extend the trial. This is a soft gate appropriate for a
// friends/beta trial — a determined user running the code locally can bypass it;
// it signals intent, it is not DRM.
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 30);
// Changing this invalidates all existing trial files (everyone restarts). Keep
// stable across a release line.
const SECRET = process.env.TRIAL_SECRET ?? 'LRA-trial-v1-6f2a9c8e-do-not-change';

const DIR = path.join(os.homedir(), '.local-redactor');
const FILE = path.join(DIR, 'trial.json');

function sign(startedAt: string): string {
  return crypto.createHmac('sha256', SECRET).update(startedAt).digest('hex');
}

interface TrialFile {
  startedAt: string; // ISO date of first run
  sig: string;
}

function readFile(): TrialFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as TrialFile;
    if (!parsed?.startedAt || !parsed?.sig) return null;
    if (sign(parsed.startedAt) !== parsed.sig) return null; // tampered
    return parsed;
  } catch {
    return null;
  }
}

function writeFile(startedAt: string): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ startedAt, sig: sign(startedAt) }, null, 2));
  } catch {
    /* if we can't persist, ensureTrial falls back to an in-memory start */
  }
}

let memoryStart: string | null = null; // fallback if the home dir isn't writable

// Returns the trial start, creating it on first run. A present-but-tampered file
// is treated as already-expired (not reset) so corrupting it can't extend it.
function getStart(): { startedAt: string; tampered: boolean } {
  const existing = readFile();
  if (existing) return { startedAt: existing.startedAt, tampered: false };

  // No valid file. Distinguish "first run" (no file at all) from "tampered".
  const fileExists = fs.existsSync(FILE);
  if (fileExists) return { startedAt: new Date(0).toISOString(), tampered: true };

  const startedAt = memoryStart ?? new Date().toISOString();
  memoryStart = startedAt;
  writeFile(startedAt);
  return { startedAt, tampered: false };
}

export interface TrialStatus {
  startedAt: string;
  expiresAt: string;
  daysLeft: number;
  expired: boolean;
  trialDays: number;
}

export function trialStatus(): TrialStatus {
  const { startedAt, tampered } = getStart();
  const start = new Date(startedAt).getTime();
  const expiresAtMs = start + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const daysLeft = Math.max(0, Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000)));
  return {
    startedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    daysLeft,
    expired: tampered || now > expiresAtMs,
    trialDays: TRIAL_DAYS,
  };
}

// The express guard (accessGuard) is now in license.ts — it checks the license
// first, then falls back to this trial status.
