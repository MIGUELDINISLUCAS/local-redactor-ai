import { describe, it, expect, beforeEach } from 'vitest';
import { detectEntities } from '../ruleBasedDetector';
import { chunkForNer, nerWindows } from '../nerDetector';
import { glinerWindows } from '../glinerEngine';
import { isContextualPlace, applyContextDefaults } from '../contextTerms';
import { createRegistry, registerEntities, getOrCreatePlaceholder } from '../placeholderRegistry';
import { anonymiseText } from '../anonymise';
import { restoreText } from '../restore';
import { parseFile } from '../../parsers/parseFile';
import type { PlaceholderRegistry } from '../types';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('detectEntities', () => {
  it('detects email addresses', () => {
    const results = detectEntities('Contact alice@example.com for help.');
    expect(results.some((e) => e.originalValue === 'alice@example.com')).toBe(true);
  });

  it('detects phone numbers', () => {
    const results = detectEntities('Call +44 7700 900123 now.');
    expect(results.some((e) => e.category === 'PHONE')).toBe(true);
  });

  it('detects UUIDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const results = detectEntities(`ID: ${uuid}`);
    expect(results.some((e) => e.originalValue === uuid)).toBe(true);
  });

  it('captures a UK National Insurance number whole, even with a non-standard suffix', () => {
    // "QQ 19 38 57 F" — suffix F is not an official A–D suffix, but the tool must
    // still redact the whole token rather than let PHONE grab only "19 38 57"
    // (which would leak "QQ … F"). Regression for the demo mis-categorisation.
    const results = detectEntities('national insurance number QQ 19 38 57 F.');
    const ni = results.find((e) => e.originalValue === 'QQ 19 38 57 F');
    expect(ni).toBeDefined();
    expect(ni?.category).toBe('TAX_ID');
    // And the greedy PHONE rule must not also emit the middle digits on their own.
    expect(results.some((e) => e.category === 'PHONE' && e.originalValue.includes('19 38 57'))).toBe(false);
  });

  it('returns nothing for empty or whitespace input without throwing', () => {
    expect(detectEntities('')).toEqual([]);
    expect(detectEntities('   \n  ')).toEqual([]);
  });

  it('does not match partial emails or bare @ symbols', () => {
    const results = detectEntities('contact me @handle or at john@');
    expect(results.some((e) => e.category === 'EMAIL')).toBe(false);
  });

  it('detects symbol-prefixed monetary amounts', () => {
    const results = detectEntities('The invoice total is £4,500.00 plus $20.');
    expect(results.some((e) => e.category === 'MONETARY' && e.originalValue.includes('4,500.00'))).toBe(true);
  });

  it('counts occurrences of duplicate values', () => {
    const results = detectEntities('Send to alice@x.com and also alice@x.com again.');
    const email = results.find((e) => e.originalValue === 'alice@x.com');
    expect(email?.occurrences).toBe(2);
  });

  it('does not flag ordinary uppercase words as SWIFT/BIC', () => {
    const results = detectEntities('Tokens deployed on ETHEREUM via LIQUID staking.');
    expect(results.some((e) => e.category === 'SWIFT_BIC')).toBe(false);
  });

  it('detects keyword-anchored SWIFT/BIC codes', () => {
    const results = detectEntities('Pay via SWIFT: DEUTDEFF500 before noon.');
    expect(results.some((e) => e.category === 'SWIFT_BIC' && e.originalValue === 'DEUTDEFF500')).toBe(true);
  });

  it('detects keyword-anchored registration numbers', () => {
    const results = detectEntities('registered in the Companies Registry with number 418773.');
    expect(results.some((e) => e.category === 'REGISTRATION' && e.originalValue === '418773')).toBe(true);
  });

  it('does not flag bare numbers as registration without a keyword', () => {
    const results = detectEntities('the minimum 32 ETH staking threshold');
    expect(results.some((e) => e.category === 'REGISTRATION')).toBe(false);
  });

  it('detects PO Box and UK postcodes', () => {
    const results = detectEntities('Write to P.O. Box 72, London SW1A 1AA.');
    const vals = results.filter((e) => e.category === 'POSTAL_CODE').map((e) => e.originalValue);
    expect(vals).toContain('P.O. Box 72');
    expect(vals).toContain('SW1A 1AA');
  });

  it('handles overlapping matches without duplicating', () => {
    // IP inside URL — should not double-count
    const results = detectEntities('http://192.168.1.1/path');
    const urls = results.filter((e) => e.category === 'URL');
    expect(urls.length).toBeLessThanOrEqual(1);
  });
});

describe('chunkForNer', () => {
  it('returns a single chunk for short text', () => {
    expect(chunkForNer('hello world', 2500)).toHaveLength(1);
  });

  it('splits long text into multiple chunks within the size limit', () => {
    const para = 'Sentence about Acme Corp in London.\n\n';
    const long = para.repeat(300); // ~10k chars
    const chunks = chunkForNer(long, 2500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2500 + para.length);
    // No content lost: every paragraph's key term survives across the chunks.
    expect(chunks.join('').match(/Acme Corp/g)?.length).toBe(300);
  });

  it('hard-splits a single oversized paragraph', () => {
    const huge = 'x'.repeat(7000);
    const chunks = chunkForNer(huge, 2500);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2500);
  });
});

describe('nerWindows (batching + overlap)', () => {
  it('returns a single window for input just under the batch size', () => {
    const text = 'Acme Corp in London.'.padEnd(2400, ' ');
    const windows = nerWindows(text, 2500, 250);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toBe(text);
  });

  it('splits input well over the batch size into multiple ordered windows', () => {
    const para = 'Clause about Acme Corp in London.\n\n';
    const long = para.repeat(400); // ~14k chars
    const windows = nerWindows(long, 2500, 250);
    expect(windows.length).toBeGreaterThan(3);
    // Each window stays within the batch size plus the overlap margin.
    for (const w of windows) expect(w.length).toBeLessThanOrEqual(2500 + 250);
    // Order is preserved: concatenating windows (minus the overlap prefix of
    // each subsequent window) reconstructs the original content in sequence.
    expect(windows[0].startsWith('Clause about Acme Corp')).toBe(true);
  });

  it('keeps an entity that straddles a hard-cut boundary whole in some window', () => {
    // One giant paragraph (no blank lines) forces a hard cut. Place a unique
    // entity exactly at the cut so it would be split without overlap.
    const maxChars = 2000;
    const filler = 'x'.repeat(maxChars - 5);
    const entity = 'ZARQUONINDUSTRIES';
    const text = filler + entity + 'y'.repeat(1000); // entity spans the 2000 boundary
    const windows = nerWindows(text, maxChars, 250);
    expect(windows.length).toBeGreaterThan(1);
    // The full entity appears intact in at least one window thanks to overlap.
    expect(windows.some((w) => w.includes(entity))).toBe(true);
  });
});

describe('contextTerms (curated places kept as context)', () => {
  it('treats bare countries/jurisdictions as contextual (EN + PT)', () => {
    expect(isContextualPlace('Portugal', 'LOCATION')).toBe(true);
    expect(isContextualPlace('frança', 'LOCATION')).toBe(true);
    expect(isContextualPlace('European Union', 'ORGANIZATION')).toBe(true);
  });

  it('does not treat people or specific addresses as contextual', () => {
    expect(isContextualPlace('Miguel', 'PERSON')).toBe(false);
    expect(isContextualPlace('Harbour Place, George Town', 'LOCATION')).toBe(false);
    expect(isContextualPlace('Acme Corp', 'ORGANIZATION')).toBe(false);
  });

  it('defaults curated countries, cities and dates to excluded; names stay redacted', () => {
    const entities = [
      { id: '1', originalValue: 'Miguel', category: 'PERSON', source: 'ner', occurrences: 1, placeholder: '[PERSON_001]', include: true },
      { id: '2', originalValue: 'Portugal', category: 'LOCATION', source: 'ner', occurrences: 1, placeholder: '[LOCATION_001]', include: true },
      { id: '3', originalValue: 'Lisbon', category: 'LOCATION', source: 'ner', occurrences: 1, placeholder: '[LOCATION_002]', include: true },
      { id: '4', originalValue: 'Guy', category: 'LOCATION', source: 'ner', occurrences: 1, placeholder: '[LOCATION_003]', include: true },
      { id: '5', originalValue: '15 January 2025', category: 'DATE', source: 'regex', occurrences: 1, placeholder: '[DATE_001]', include: true },
    ] as any;
    applyContextDefaults(entities);
    expect(entities[0].include).toBe(true);  // person stays redacted
    expect(entities[1].include).toBe(false); // curated country kept as context
    expect(entities[2].include).toBe(false); // curated city kept as context
    expect(entities[3].include).toBe(true);  // misclassified name ("Guy") anonymised — no silent leak
    expect(entities[4].include).toBe(false); // date kept as context
  });
});

describe('glinerWindows (default-model boundary safety)', () => {
  it('keeps an entity crossing a hard boundary whole in an overlapping window', () => {
    const maxChars = 100;
    const entity = 'Eleanor Whitfield';
    const text = 'x'.repeat(maxChars - 8) + entity + 'y'.repeat(80);
    const windows = glinerWindows(text, maxChars, 40);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.some((w) => w.includes(entity))).toBe(true);
  });
});

describe('parseFile cleanup', () => {
  it('removes a temporary upload even when validation rejects it', async () => {
    const file = path.join(os.tmpdir(), `lra-test-${Date.now()}.bin`);
    fs.writeFileSync(file, 'not a supported document');
    await expect(parseFile(file, 'application/octet-stream', 'payload.bin')).rejects.toThrow('Unsupported file type');
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('placeholderRegistry', () => {
  let registry: PlaceholderRegistry;

  beforeEach(() => { registry = createRegistry(); });

  it('assigns stable placeholder for same value', () => {
    const p1 = getOrCreatePlaceholder(registry, 'alice@x.com', 'EMAIL');
    const p2 = getOrCreatePlaceholder(registry, 'alice@x.com', 'EMAIL');
    expect(p1).toBe(p2);
  });

  it('assigns different placeholders for different values', () => {
    const p1 = getOrCreatePlaceholder(registry, 'alice@x.com', 'EMAIL');
    const p2 = getOrCreatePlaceholder(registry, 'bob@x.com', 'EMAIL');
    expect(p1).not.toBe(p2);
  });

  it('uses category-specific prefix', () => {
    const p = getOrCreatePlaceholder(registry, 'alice@x.com', 'EMAIL');
    expect(p).toMatch(/^\[EMAIL_\d{3}\]$/);
  });

  it('increments counter per category independently', () => {
    getOrCreatePlaceholder(registry, 'alice@x.com', 'EMAIL');
    const p2 = getOrCreatePlaceholder(registry, 'bob@x.com', 'EMAIL');
    expect(p2).toBe('[EMAIL_002]');
    const p3 = getOrCreatePlaceholder(registry, '+44 7700 900123', 'PHONE');
    expect(p3).toBe('[PHONE_001]');
  });
});

describe('anonymiseText', () => {
  it('replaces detected entities in text', () => {
    const registry = createRegistry();
    const raw = detectEntities('Email alice@x.com for info.');
    const entities = registerEntities(registry, raw);
    const result = anonymiseText('Email alice@x.com for info.', entities, registry);
    expect(result.anonymisedText).not.toContain('alice@x.com');
    expect(result.anonymisedText).toContain('[EMAIL_001]');
  });

  it('replaces all occurrences', () => {
    const registry = createRegistry();
    const raw = detectEntities('a@b.com and a@b.com');
    const entities = registerEntities(registry, raw);
    const result = anonymiseText('a@b.com and a@b.com', entities, registry);
    expect(result.anonymisedText).toBe('[EMAIL_001] and [EMAIL_001]');
  });

  it('skips excluded entities', () => {
    const registry = createRegistry();
    const raw = detectEntities('Email alice@x.com');
    const entities = registerEntities(registry, raw).map((e) => ({ ...e, include: false }));
    const result = anonymiseText('Email alice@x.com', entities, registry);
    expect(result.anonymisedText).toContain('alice@x.com');
  });
});

describe('restoreText', () => {
  it('restores placeholders to original values', () => {
    const registry = createRegistry();
    getOrCreatePlaceholder(registry, 'alice@x.com', 'EMAIL');
    const result = restoreText('Contact [EMAIL_001] asap.', registry);
    expect(result.restoredText).toBe('Contact alice@x.com asap.');
    expect(result.restoredCount).toBe(1);
    expect(result.unresolvedCount).toBe(0);
  });

  it('warns on missing placeholders', () => {
    const registry = createRegistry();
    const result = restoreText('[EMAIL_099] unknown.', registry);
    expect(result.unresolvedCount).toBe(1);
    expect(result.warnings.some((w) => w.reason === 'not_found_in_registry')).toBe(true);
  });

  it('does not flag ordinary bracketed text as malformed', () => {
    const registry = createRegistry();
    getOrCreatePlaceholder(registry, 'a@b.com', 'EMAIL');
    const result = restoreText('[MOCK LLM RESPONSE] from [EMAIL_001]', registry);
    expect(result.warnings).toHaveLength(0);
    expect(result.restoredText).toBe('[MOCK LLM RESPONSE] from a@b.com');
  });

  it('flags corrupted placeholders as malformed', () => {
    const registry = createRegistry();
    const result = restoreText('Value [EMAIL_1] is corrupted.', registry);
    expect(result.warnings.some((w) => w.reason === 'malformed_placeholder')).toBe(true);
  });

  it('handles text with no placeholders', () => {
    const registry = createRegistry();
    const result = restoreText('No placeholders here.', registry);
    expect(result.restoredText).toBe('No placeholders here.');
    expect(result.warnings).toHaveLength(0);
  });

  it('restores repeated placeholders and counts each occurrence', () => {
    const registry = createRegistry();
    getOrCreatePlaceholder(registry, 'a@b.com', 'EMAIL');
    const result = restoreText('[EMAIL_001] and again [EMAIL_001].', registry);
    expect(result.restoredText).toBe('a@b.com and again a@b.com.');
    expect(result.restoredCount).toBe(2);
  });

  it('handles empty input without throwing', () => {
    const registry = createRegistry();
    const result = restoreText('', registry);
    expect(result.restoredText).toBe('');
    expect(result.warnings).toHaveLength(0);
  });
});
