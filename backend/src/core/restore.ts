import { PlaceholderRegistry, RestorationResult, RestorationWarning } from './types';

const PLACEHOLDER_RE = /\[[A-Z_]+_\d{3}\]/g;

export function restoreText(
  anonymisedOutput: string,
  registry: PlaceholderRegistry
): RestorationResult {
  const warnings: RestorationWarning[] = [];
  let restoredCount = 0;
  let unresolvedCount = 0;

  const placeholders = [...new Set(anonymisedOutput.match(PLACEHOLDER_RE) ?? [])];

  // Validate each found placeholder
  for (const ph of placeholders) {
    if (!registry.entries.has(ph)) {
      warnings.push({ placeholder: ph, reason: 'not_found_in_registry' });
    }
  }

  const restoredText = anonymisedOutput.replace(PLACEHOLDER_RE, (match) => {
    const mapping = registry.entries.get(match);
    if (mapping) {
      restoredCount++;
      return mapping.originalValue;
    }
    unresolvedCount++;
    return match; // leave in place
  });

  // Detect malformed placeholders: tokens that clearly look like a corrupted
  // placeholder (CATEGORY + separator + digits in brackets) but don't match the
  // canonical [CATEGORY_NNN] shape. Requires a digit before the closing bracket
  // so ordinary bracketed text like "[MOCK LLM RESPONSE]" is not flagged.
  const malformed = restoredText.match(/\[[A-Z]+[_ ]\d{1,}\]/g)?.filter(
    (m) => !/^\[[A-Z_]+_\d{3}\]$/.test(m)
  ) ?? [];
  for (const m of malformed) {
    warnings.push({ placeholder: m, reason: 'malformed_placeholder' });
  }

  return { restoredText, warnings, restoredCount, unresolvedCount };
}
