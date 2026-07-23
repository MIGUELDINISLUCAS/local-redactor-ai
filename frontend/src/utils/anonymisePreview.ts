import type { SensitiveEntity, DetectionCategory, PlaceholderMapping } from '../types';

// Mirrors backend CATEGORY_PREFIX so client-side placeholders match what the
// server would assign on approve.
const PREFIX: Record<DetectionCategory, string> = {
  EMAIL: 'EMAIL', PHONE: 'PHONE', URL: 'URL', IP_ADDRESS: 'IP', UUID: 'UUID',
  IBAN: 'IBAN', SWIFT_BIC: 'SWIFT', CREDIT_CARD: 'CARD', CRYPTO_WALLET: 'WALLET',
  CRYPTO_TX: 'TX', FILE_PATH: 'PATH', DATE: 'DATE', MONETARY: 'AMOUNT',
  TAX_ID: 'TAXID', REGISTRATION: 'REGNO', POSTAL_CODE: 'POSTCODE',
  PERSON: 'PERSON', ORGANIZATION: 'ORG', ADDRESS: 'ADDRESS',
  LOCATION: 'LOCATION', PII: 'PII', CUSTOM: 'CUSTOM',
};

// Live preview that mirrors backend core/anonymise.ts: longest values first,
// regex-escaped, replace every occurrence of included entities.
export function anonymisePreview(text: string, entities: SensitiveEntity[]): string {
  const active = entities.filter((e) => e.include && e.originalValue);
  const sorted = [...active].sort((a, b) => b.originalValue.length - a.originalValue.length);
  let out = text;
  for (const e of sorted) {
    const escaped = e.originalValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Whole-token replace for letter/digit-edged values (so "ena" isn't spliced
    // out of "penalty"); punctuation-edged values use a plain match.
    const edged = /^[\p{L}\p{N}]/u.test(e.originalValue) && /[\p{L}\p{N}]$/u.test(e.originalValue);
    const src = edged ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
    out = out.replace(new RegExp(src, 'gu'), e.placeholder);
  }
  return out;
}

// Pick the next free placeholder for a category, reusing an existing one if the
// same value is already mapped (so duplicates stay consistent).
export function placeholderFor(
  value: string,
  category: DetectionCategory,
  entities: SensitiveEntity[],
  mappings: PlaceholderMapping[]
): string {
  const existing =
    entities.find((e) => e.originalValue === value)?.placeholder ??
    mappings.find((m) => m.originalValue === value)?.placeholder;
  if (existing) return existing;

  const prefix = PREFIX[category];
  const re = new RegExp(`\\[${prefix}_(\\d+)\\]`);
  let max = 0;
  const scan = (ph: string) => {
    const m = ph.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  };
  entities.forEach((e) => scan(e.placeholder));
  mappings.forEach((m) => scan(m.placeholder));
  return `[${prefix}_${String(max + 1).padStart(3, '0')}]`;
}
