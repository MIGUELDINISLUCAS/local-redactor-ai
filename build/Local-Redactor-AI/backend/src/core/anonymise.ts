import { AnonymisationResult, PlaceholderRegistry, SensitiveEntity } from './types';

export function anonymiseText(
  text: string,
  entities: SensitiveEntity[],
  registry: PlaceholderRegistry
): AnonymisationResult {
  // Only process entities the user has included
  const active = entities.filter((e) => e.include);

  // Sort by length descending so longer values are replaced first (prevents partial matches)
  const sorted = [...active].sort(
    (a, b) => b.originalValue.length - a.originalValue.length
  );

  let anonymisedText = text;
  for (const entity of sorted) {
    // Escape special regex chars in the original value.
    const escaped = entity.originalValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Replace whole tokens only for letter/digit-edged values, so a short value
    // like "ena" isn't spliced out of "penalty". Punctuation-edged values
    // (emails, IBANs) use a plain match.
    const v = entity.originalValue;
    const edged = /^[\p{L}\p{N}]/u.test(v) && /[\p{L}\p{N}]$/u.test(v);
    const src = edged ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
    anonymisedText = anonymisedText.replace(new RegExp(src, 'gu'), entity.placeholder);
  }

  // FAIL-SAFE. The whole-word pass above can silently skip a value: if detection
  // produced a match starting mid-token (PHONE matching "50 0047…" inside
  // "PT50 0047…"), the lookbehind never fires and the value ships RAW — while the
  // review table still shows it with a placeholder, i.e. the UI claims protection
  // it didn't deliver. Never let a ticked entity through: fall back to a plain
  // substring replace, then verify. Over-replacing is recoverable; leaking is not.
  const unreplaced: string[] = [];
  for (const entity of sorted) {
    if (anonymisedText.includes(entity.originalValue)) {
      const escaped = entity.originalValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      anonymisedText = anonymisedText.replace(new RegExp(escaped, 'g'), entity.placeholder);
    }
    // If it STILL survives, the caller must block rather than send.
    if (anonymisedText.includes(entity.originalValue)) unreplaced.push(entity.originalValue);
  }

  const mappings = active.map((e) => ({
    placeholder: e.placeholder,
    originalValue: e.originalValue,
    category: e.category,
  }));

  return { anonymisedText, entities, mappings, unreplaced };
}
