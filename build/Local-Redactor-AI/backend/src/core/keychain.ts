import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// API keys are stored in the macOS login Keychain via the built-in `security`
// CLI — never in our own files, never logged, never sent anywhere except to the
// provider the key belongs to. Service namespaces all our entries.
const SERVICE = 'local-redactor-ai';

export type ProviderId = 'openai' | 'anthropic';

function account(provider: ProviderId): string {
  return `apikey:${provider}`;
}

export async function setApiKey(provider: ProviderId, apiKey: string): Promise<void> {
  // -U updates if it already exists. -w passes the secret as the password.
  await execFileAsync('security', [
    'add-generic-password',
    '-a', account(provider),
    '-s', SERVICE,
    '-w', apiKey,
    '-U',
  ]);
}

export async function getApiKey(provider: ProviderId): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-a', account(provider),
      '-s', SERVICE,
      '-w',
    ]);
    return stdout.trim() || null;
  } catch {
    return null; // not found
  }
}

export async function hasApiKey(provider: ProviderId): Promise<boolean> {
  return (await getApiKey(provider)) !== null;
}

export async function deleteApiKey(provider: ProviderId): Promise<void> {
  try {
    await execFileAsync('security', [
      'delete-generic-password',
      '-a', account(provider),
      '-s', SERVICE,
    ]);
  } catch {
    // already absent — fine
  }
}
