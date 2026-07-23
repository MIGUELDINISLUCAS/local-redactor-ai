import { SensitiveEntity, DetectionCategory } from './types';
import { detectEntities } from './ruleBasedDetector';
import { detectWithNer, isOllamaAvailable, type NerProgress, type NerEngine } from './nerDetector';

type RawEntity = Omit<SensitiveEntity, 'id' | 'placeholder' | 'include'>;

const ENABLE_NER = (process.env.ENABLE_NER ?? 'true') !== 'false';

export interface CustomRuleInput {
  pattern: string;
  category: DetectionCategory;
  isRegex?: boolean;
}

export interface DetectionOutcome {
  entities: RawEntity[];
  nerUsed: boolean;
  // True when NER was expected to run (Ollama reachable) but did not contribute
  // (timed out / failed) — the caller should warn before sending.
  nerPartial: boolean;
  // Which NER engine actually ran, so the UI shows the truth (a 'thorough'
  // request that fell back reports 'fast-fallback', not 'thorough').
  nerEngine?: NerEngine;
}

// Safely compile user-supplied rules into [category, RegExp] pairs. Literal
// terms are escaped; invalid regexes are skipped rather than crashing.
function compileRules(rules: CustomRuleInput[]): Array<[DetectionCategory, RegExp]> {
  const compiled: Array<[DetectionCategory, RegExp]> = [];
  for (const r of rules) {
    if (!r?.pattern) continue;
    try {
      if (r.isRegex) {
        // Explicit regex keeps its own semantics.
        compiled.push([r.category ?? 'CUSTOM', new RegExp(r.pattern, 'g')]);
      } else {
        // Literal terms match case-insensitively AND as whole tokens, so a rule
        // like "ena" doesn't match inside "penalty". Word boundaries only when
        // the term is letter/digit-edged; punctuation-edged terms use substring.
        const esc = r.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const edged = /^[\p{L}\p{N}]/u.test(r.pattern) && /[\p{L}\p{N}]$/u.test(r.pattern);
        const source = edged ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc;
        compiled.push([r.category ?? 'CUSTOM', new RegExp(source, 'giu')]);
      }
    } catch {
      // skip invalid regex
    }
  }
  return compiled;
}

// Combine deterministic regex detection with local NER (names, orgs, addresses,
// locations). Regex results take precedence: an NER entity is dropped if its
// value is already covered by, or overlaps, a regex match's value.
// Turn the user's literal rules into a short instruction the NER model can learn
// from. Regex rules are patterns (not useful as examples) and are skipped; the
// list is capped so the prompt stays small and fast.
function buildExamples(rules: CustomRuleInput[], ignore: string[] = []): string | undefined {
  const literals = rules
    .filter((r) => r && r.pattern && !r.isRegex)
    .slice(-20)
    .map((r) => `"${r.pattern}" (${(r.category ?? 'CUSTOM').toLowerCase()})`);
  const notSensitive = ignore.filter(Boolean).slice(-30).map((s) => `"${s}"`);

  const parts: string[] = [];
  if (literals.length) {
    parts.push(
      'The user has marked the following as sensitive. Also detect OTHER entities ' +
      'of the same kind (not only these exact words):\n' + literals.join('\n')
    );
  }
  if (notSensitive.length) {
    // Negative feedback: the user unticked these, so they are NOT sensitive.
    parts.push(
      'The user has confirmed the following are NOT sensitive — do NOT flag them ' +
      'or similar generic terms:\n' + notSensitive.join(', ')
    );
  }
  return parts.length ? parts.join('\n\n') : undefined;
}

export async function detectAll(
  text: string,
  opts: {
    enableNer?: boolean;
    customRules?: CustomRuleInput[];
    onProgress?: NerProgress;
    signal?: AbortSignal;
    model?: string;
    ignore?: string[];
    thorough?: boolean;
  } = {}
): Promise<DetectionOutcome> {
  // Terms the user has marked NOT sensitive (unticked). Dropped from results and
  // fed to the model as negative examples so it stops flagging them.
  const ignoreSet = new Set((opts.ignore ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean));
  const notIgnored = (list: RawEntity[]) =>
    ignoreSet.size ? list.filter((e) => !ignoreSet.has(e.originalValue.toLowerCase().trim())) : list;

  const regex = notIgnored(detectEntities(text, compileRules(opts.customRules ?? [])));

  const useNer = opts.enableNer ?? ENABLE_NER;
  if (!useNer) return { entities: regex, nerUsed: false, nerPartial: false };

  // Teach the NER model from the user's saved rules (in-context learning): pass
  // their literal terms as examples so it also flags OTHER entities of the same
  // kind — generalisation beyond the exact-match the regex layer already gives.
  const examples = buildExamples(opts.customRules ?? [], opts.ignore ?? []);

  // No size cap: large inputs are always run through NER, transparently batched
  // into overlapping windows inside detectWithNer. Regex still runs alongside as
  // a fast, deterministic supplement and is merged below.
  const ner = await detectWithNer(text, opts.onProgress, opts.signal, examples, opts.model, opts.thorough);
  if (!ner.available) {
    // NER produced nothing. If Ollama is actually reachable, this is a real
    // failure (timeout/error) and we must warn; if it's simply not running,
    // that's the expected "NER off" state and the header already shows it.
    const reachable = await isOllamaAvailable();
    return { entities: regex, nerUsed: false, nerPartial: reachable };
  }

  // Merge additively. Regex is the deterministic floor and is NEVER dropped.
  // An NER entity is added unless regex already covers the same-or-bigger span
  // (i.e. the NER value is equal to, or a substring of, a regex value). Crucially
  // we DO add NER entities that are a *superset* of a regex value — e.g. NER
  // "MA-48392017" over regex "48392017" — so the model fills gaps and fixes
  // truncated/mistyped regex hits (longest-first replacement then covers the
  // fuller span). The model can only ever add or extend protection, never remove.
  const regexValues = regex.map((e) => e.originalValue);
  const merged: RawEntity[] = [...regex];
  for (const e of notIgnored(ner.entities)) {
    const alreadyCovered = regexValues.some((rv) => rv.includes(e.originalValue));
    if (!alreadyCovered) merged.push(e);
  }

  // Family-member catch: models reliably tag "John Carter" and "Emily Carter"
  // but sometimes drop "Lily Carter". Propagate detected surnames — find other
  // "<Capitalised> <knownSurname>" mentions and add them as PERSON. Deterministic
  // and additive; only ever adds protection.
  for (const p of propagateSurnames(text, merged)) merged.push(p);

  return { entities: notIgnored(merged), nerUsed: true, nerPartial: !!ner.partial, nerEngine: ner.engine };
}

function propagateSurnames(text: string, entities: RawEntity[]): RawEntity[] {
  const surnames = new Set<string>();
  for (const e of entities) {
    if (e.category !== 'PERSON') continue;
    const tokens = e.originalValue.trim().split(/\s+/);
    const last = tokens[tokens.length - 1];
    if (tokens.length >= 2 && last.length >= 3 && /^[\p{Lu}]/u.test(last)) surnames.add(last);
  }
  if (!surnames.size) return [];

  const additions: RawEntity[] = [];
  const seen = new Set<string>();
  for (const surname of surnames) {
    const esc = surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // "<Capitalised firstname> <surname>" as a whole token run.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(\\p{Lu}[\\p{L}'’-]+)\\s+${esc}(?![\\p{L}\\p{N}])`, 'gu');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const full = m[0];
      if (seen.has(full)) continue;
      // Skip if an existing entity already contains this mention (e.g. the match
      // "Rose Carter" inside the detected "Emily Rose Carter").
      if (entities.some((e) => e.originalValue.includes(full))) continue;
      seen.add(full);
      additions.push({
        originalValue: full,
        category: 'PERSON',
        source: 'ner',
        occurrences: text.split(full).length - 1,
      });
    }
  }
  return additions;
}
