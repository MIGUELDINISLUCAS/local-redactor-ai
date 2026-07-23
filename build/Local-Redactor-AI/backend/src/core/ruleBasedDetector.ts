import { DetectionCategory, DetectionSource, SensitiveEntity } from './types';
import { institutionRules } from './ptGazetteer';
import { cityRules } from './cityGazetteer';

interface RawMatch {
  value: string;
  category: DetectionCategory;
  start: number;
  end: number;
}

// Each entry: [category, regex]
const RULES: Array<[DetectionCategory, RegExp]> = [
  ['EMAIL',        /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g],
  // The leading boundary is CRITICAL: without it PHONE matched mid-token — it
  // grabbed "50 0047 7654…" from inside "PT50 0047 7654…", so the IBAN was
  // detected as a PHONE starting mid-word. Whole-word replacement then refused to
  // replace it, and the value shipped RAW while the review table showed it as
  // protected. A detected-but-unreplaceable entity is the worst failure mode.
  ['PHONE',        /(?<![\p{L}\p{N}])(?:\+?\d[\d\s\-().]{6,}\d)/gu],
  ['URL',          /https?:\/\/[^\s"'<>]+/g],
  ['IP_ADDRESS',   /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ['UUID',         /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g],
  // IBANs are almost always written SPACED in real documents ("GB62 TEST 3098
  // 1122 3344 55", "PT50 0047 7654 3210 9876 5432 6"). The old contiguous-only
  // pattern never matched those, so the greedy PHONE rule grabbed the digits and
  // the country prefix ("GB62 TEST") leaked. Groups are optional-space so both
  // spaced and contiguous forms match whole, and being the longest span it wins
  // the overlap against PHONE in resolveOverlaps().
  ['IBAN',         /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g],
  // Anchor BIC/SWIFT to a preceding keyword — an unanchored 8-letter uppercase
  // pattern matches ordinary words (ETHEREUM, etc.) and floods false positives.
  ['SWIFT_BIC',    /(?<=\b(?:SWIFT|BIC)(?:\s*code)?[:\s]{1,3})[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi],
  ['CREDIT_CARD',  /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g],
  ['CRYPTO_WALLET',/\b(?:0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{25,39})\b/g],
  ['CRYPTO_TX',    /\b0x[a-fA-F0-9]{64}\b/g],
  ['FILE_PATH',    /(?:\/[\w.\-]+){2,}|(?:[A-Za-z]:\\(?:[\w.\- ]+\\)*[\w.\- ]+)/g],
  ['DATE',         /\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/gi],
  // Money in either order and both conventions: symbol/code BEFORE the number
  // (US: "€18.000", "$1,000") OR AFTER it (European/PT: "5.000 €", "15 000 €",
  // "30 000 euros"). The number body accepts ., , or thin spaces as separators.
  // The optional trailing group captures RANGES ("€30–40", "€50–100"). Without it
  // only the first half matched, leaving a mangled "[AMOUNT_001]–40" — and, when
  // redacting a real salary range, half of it still exposed.
  // Amounts must END in a digit — `\d[\d.,]*\d?` also matched a trailing sentence
  // period ("€12,350."), which the placeholder then swallowed, silently eating the
  // full stop. The optional trailing group captures RANGES ("€30–40"): without it
  // only the first half matched, leaving a mangled "[AMOUNT_001]–40" — and, when
  // redacting a real salary range, half of it still exposed.
  ['MONETARY',     /(?:€|£|\$|USD|EUR|GBP)\s?\d+(?:[.,]\d+)*(?:\s?[–—-]\s?\d+(?:[.,]\d+)*)?|\d+(?:[.,]\d+)*(?:\s?[–—-]\s?\d+(?:[.,]\d+)*)?\s?(?:€|£|\$|USD|EUR|GBP|euros?|cêntimos?)/gi],
  ['TAX_ID',       /\b(?:\d{2}-\d{7}|\d{3}-\d{2}-\d{4}|[A-Z]{2}\d{9}|\d{9}[A-Z])\b/g],
  // Company / registration / incorporation numbers — anchored to a keyword so we
  // don't flag every number. Matches "registered under number 418773",
  // "company no. SC123456", "Registry with number 418773".
  ['REGISTRATION', /(?<=\b(?:regist(?:ered|ration|ry)|incorporation|company)\b[^.\n]{0,40}?\b(?:number|no\.?|#)[:\s]\s*)[A-Z]{0,3}\d{4,}[A-Z]?\b/gi],
  // Postal markers: PO Box, UK-style postcodes, and Portuguese NNNN-NNN codes.
  ['POSTAL_CODE',  /\bP\.?\s?O\.?\s?Box\s+\d+\b|\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b|\b\d{4}-\d{3}\b/g],
  // Portuguese cartão de cidadão: 8 digits + check digit + 2 letters + check
  // digit, e.g. "14943635 1ZW6". Distinct shape — safe unanchored. Must win over
  // the greedy PHONE rule (which truncates it to "14943635 1", leaking "ZW6").
  ['TAX_ID',       /\b\d{8}\s?\d\s?[A-Z]{2}\s?\d\b/g],
  // NIF (personal) and NIPC (company) — 9 digits, keyword-anchored to avoid
  // flagging every 9-digit number. PT uses these heavily in contracts.
  // Digits may be SPACED in groups of three ("NIF 291 804 675") — the old
  // contiguous \d{9} missed that entirely and PHONE swallowed it instead.
  ['TAX_ID',       /(?<=\bNIF[ :.º°n\/-]{0,6})\d{3}\s?\d{3}\s?\d{3}\b/gi],
  ['REGISTRATION', /(?<=\bNIPC[ :.º°n\/-]{0,6})\d{3}\s?\d{3}\s?\d{3}\b/gi],
  // --- Identity documents -------------------------------------------------
  // These had NO patterns at all, so passports and licences shipped in the clear.
  // Keyword-anchored (lookbehind keeps the keyword OUT of the redacted value) —
  // document numbers are too shape-ambiguous to match safely unanchored.
  // "passport number UK4729185", "passaporte português n.º P4729168".
  // The gap must allow '.' — PT writes "n.º", and excluding periods (as the
  // REGISTRATION rule does) made the lookbehind unable to span it, leaking the
  // Portuguese passport while catching the English one.
  ['PII',          /(?<=\b(?:passport|passaporte)\b[^\n]{0,25}?)\b[A-Z]{1,2}\d{6,9}\b/gi],
  // "driving licence number COLLN920104ME6PQ" (UK DVLA is 16 alphanumerics);
  // kept generic because licence formats vary by country.
  ['PII',          /(?<=\b(?:driving licence|driving license|driver'?s licence|driver'?s license|carta de conduç(?:ão|ao))\b[^\n]{0,25}?)\b[A-Z0-9]{8,20}\b/gi],
  // UK National Insurance number: 2 letters + 6 digits + a final A–D, usually
  // spaced ("QQ 74 18 29 D"). Distinctive enough to match unanchored; PHONE
  // previously grabbed only the middle digits, leaking the "QQ … D" around them.
  ['TAX_ID',       /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g],
  // Curated Portuguese institutions / funders / banks the NER model tends to miss.
  ...institutionRules(),
  // Curated city/town names → LOCATION. Covers STANDALONE places ("nasceu em
  // Viseu") that GLiNER can't be asked for: its 'location' label competes with
  // 'location address' and collapses full-address recall 4/4 → 1/4.
  ...cityRules(),
];

// Categories that are deliberate, specific shapes should win an overlap against
// the broad PHONE catch-all (which otherwise swallows IDs, postcodes and dates).
function priority(category: DetectionCategory): number {
  return category === 'PHONE' ? 0 : 1;
}

function resolveOverlaps(matches: RawMatch[]): RawMatch[] {
  // Earliest start first; then longest span; then most-specific category — so a
  // same-span TAX_ID/DATE/POSTAL_CODE beats PHONE on a tie.
  matches.sort(
    (a, b) =>
      a.start - b.start || b.end - a.end || priority(b.category) - priority(a.category)
  );
  const result: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      result.push(m);
      lastEnd = m.end;
    }
  }
  return result;
}

export function detectEntities(
  text: string,
  customRules: Array<[DetectionCategory, RegExp]> = []
): Omit<SensitiveEntity, 'id' | 'placeholder' | 'include'>[] {
  const allRules = [...RULES, ...customRules];
  const rawMatches: RawMatch[] = [];

  for (const [category, regex] of allRules) {
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      rawMatches.push({
        value: match[0],
        category,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  const resolved = resolveOverlaps(rawMatches);

  // Group by value+category, counting occurrences
  const grouped = new Map<string, Omit<SensitiveEntity, 'id' | 'placeholder' | 'include'>>();
  for (const m of resolved) {
    const key = `${m.category}::${m.value}`;
    if (grouped.has(key)) {
      grouped.get(key)!.occurrences++;
    } else {
      grouped.set(key, {
        originalValue: m.value,
        category: m.category,
        source: 'regex' as DetectionSource,
        occurrences: 1,
      });
    }
  }

  return Array.from(grouped.values());
}
