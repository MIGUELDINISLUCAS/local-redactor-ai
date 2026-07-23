import { DetectionCategory, PlaceholderMapping, PlaceholderRegistry, SensitiveEntity } from './types';
import { randomUUID } from 'crypto';

const CATEGORY_PREFIX: Record<DetectionCategory, string> = {
  EMAIL:          'EMAIL',
  PHONE:          'PHONE',
  URL:            'URL',
  IP_ADDRESS:     'IP',
  UUID:           'UUID',
  IBAN:           'IBAN',
  SWIFT_BIC:      'SWIFT',
  CREDIT_CARD:    'CARD',
  CRYPTO_WALLET:  'WALLET',
  CRYPTO_TX:      'TX',
  FILE_PATH:      'PATH',
  DATE:           'DATE',
  MONETARY:       'AMOUNT',
  TAX_ID:         'TAXID',
  REGISTRATION:   'REGNO',
  POSTAL_CODE:    'POSTCODE',
  PERSON:         'PERSON',
  ORGANIZATION:   'ORG',
  ADDRESS:        'ADDRESS',
  LOCATION:       'LOCATION',
  PII:            'PII',
  CUSTOM:         'CUSTOM',
};

export function createRegistry(): PlaceholderRegistry {
  return {
    entries: new Map(),
    byValue: new Map(),
    counters: new Map(),
  };
}

function nextCounter(registry: PlaceholderRegistry, category: DetectionCategory): number {
  const current = registry.counters.get(category) ?? 0;
  const next = current + 1;
  registry.counters.set(category, next);
  return next;
}

export function getOrCreatePlaceholder(
  registry: PlaceholderRegistry,
  value: string,
  category: DetectionCategory
): string {
  const existing = registry.byValue.get(value);
  if (existing) return existing;

  const prefix = CATEGORY_PREFIX[category];
  const n = String(nextCounter(registry, category)).padStart(3, '0');
  const placeholder = `[${prefix}_${n}]`;

  const mapping: PlaceholderMapping = { placeholder, originalValue: value, category };
  registry.entries.set(placeholder, mapping);
  registry.byValue.set(value, placeholder);

  return placeholder;
}

export function registerEntities(
  registry: PlaceholderRegistry,
  rawEntities: Omit<SensitiveEntity, 'id' | 'placeholder' | 'include'>[]
): SensitiveEntity[] {
  return rawEntities.map((e) => ({
    id: randomUUID(),
    ...e,
    placeholder: getOrCreatePlaceholder(registry, e.originalValue, e.category),
    include: true,
  }));
}

export function getAllMappings(registry: PlaceholderRegistry): PlaceholderMapping[] {
  return Array.from(registry.entries.values());
}

// Re-populate a registry from previously issued mappings so that placeholders
// stay stable across multiple chat turns (same value -> same placeholder, and
// counters continue from where they left off).
export function seedRegistry(
  registry: PlaceholderRegistry,
  mappings: PlaceholderMapping[]
): void {
  for (const m of mappings) {
    registry.entries.set(m.placeholder, m);
    registry.byValue.set(m.originalValue, m.placeholder);
    const match = m.placeholder.match(/_(\d+)\]$/);
    if (match) {
      const n = parseInt(match[1], 10);
      const current = registry.counters.get(m.category) ?? 0;
      if (n > current) registry.counters.set(m.category, n);
    }
  }
}

export function exportRegistry(registry: PlaceholderRegistry): string {
  return JSON.stringify(getAllMappings(registry), null, 2);
}
