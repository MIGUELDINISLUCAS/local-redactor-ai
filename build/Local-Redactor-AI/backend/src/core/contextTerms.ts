import { SensitiveEntity } from './types';
import { isGazetteerCity } from './cityGazetteer';

// Bare country / jurisdiction names are *context*, not confidential identifiers:
// redacting "Portugal" or "France" from a legal question strips the very
// information the LLM needs to answer well, while protecting nothing private.
// These are therefore detected (so they still appear in the review table) but
// default to EXCLUDED — the user can opt to redact them per message.
//
// Bilingual (EN + PT) because the app is used in Portuguese; values are matched
// case-insensitively against the verbatim entity text.
const COUNTRIES_AND_JURISDICTIONS = new Set(
  [
    // Supranational / blocs
    'european union', 'união europeia', 'uniao europeia', 'eu', 'ue', 'schengen',
    'united nations', 'nato', 'mercosul', 'mercosur',
    // Common countries — English
    'portugal', 'spain', 'france', 'germany', 'italy', 'united kingdom', 'uk',
    'england', 'scotland', 'wales', 'ireland', 'netherlands', 'belgium',
    'luxembourg', 'switzerland', 'austria', 'poland', 'czech republic', 'czechia',
    'slovakia', 'hungary', 'romania', 'bulgaria', 'greece', 'croatia', 'slovenia',
    'sweden', 'norway', 'denmark', 'finland', 'iceland', 'estonia', 'latvia',
    'lithuania', 'united states', 'united states of america', 'usa', 'u.s.',
    'u.s.a.', 'canada', 'mexico', 'brazil', 'argentina', 'chile', 'colombia',
    'peru', 'venezuela', 'uruguay', 'paraguay', 'bolivia', 'ecuador',
    'china', 'japan', 'india', 'australia', 'new zealand', 'south africa',
    'russia', 'ukraine', 'turkey', 'israel', 'egypt', 'morocco', 'angola',
    'mozambique', 'cape verde', 'cayman islands', 'crimea',
    // Common countries — Portuguese
    'espanha', 'frança', 'franca', 'alemanha', 'itália', 'italia', 'reino unido',
    'inglaterra', 'escócia', 'escocia', 'país de gales', 'pais de gales',
    'irlanda', 'holanda', 'países baixos', 'paises baixos', 'bélgica', 'belgica',
    'luxemburgo', 'suíça', 'suica', 'áustria', 'austria', 'polónia', 'polonia',
    'suécia', 'suecia', 'noruega', 'dinamarca', 'finlândia', 'finlandia',
    'islândia', 'islandia', 'estados unidos', 'eua', 'canadá', 'canada',
    'méxico', 'mexico', 'brasil', 'argentina', 'chile', 'colômbia', 'colombia',
    'venezuela', 'uruguai', 'paraguai', 'bolívia', 'bolivia', 'equador',
    'china', 'japão', 'japao', 'índia', 'india', 'austrália', 'australia',
    'nova zelândia', 'nova zelandia', 'rússia', 'russia', 'ucrânia', 'ucrania',
    'turquia', 'israel', 'egito', 'marrocos', 'angola', 'moçambique', 'mocambique',
    'cabo verde', 'grécia', 'grecia', 'roménia', 'romenia', 'hungria',
  ].map((s) => s.toLowerCase())
);

export function isContextualPlace(value: string, category: string): boolean {
  if (category !== 'LOCATION' && category !== 'ORGANIZATION') return false;
  if (COUNTRIES_AND_JURISDICTIONS.has(value.trim().toLowerCase())) return true;
  // Known cities are context too — same reasoning as countries. Matched BY VALUE
  // against the curated gazetteer, NOT by category: a gazetteer hit is
  // definitionally a place, whereas a LOCATION we can't find there may be a
  // misclassified person name ("Guy") and must stay anonymised by default.
  return isGazetteerCity(value);
}

// Default to NOT-anonymised only the things that are clearly context, not
// private identifiers: ordinary dates, prices, and CURATED places — countries /
// jurisdictions (Portugal, France, EU…) plus known cities from the gazetteer.
// Redacting "Lisbon" out of "Lisbon weekend picks" protects nothing and strips
// the very information the LLM needs; the user can tick a city when it IS
// personal (e.g. where they live). Everything else — including a LOCATION we
// canNOT find in the gazetteer, which may be a misclassified name like "Guy" —
// stays anonymised by default so a misclassification can't silently leak.
// Birth dates ARE sensitive, so a DATE that sits right after a "born"/"nascido"
// cue stays ON by default even though ordinary dates default OFF.
const BIRTH_CUE =
  /\b(born|birth|date of birth|d\.?o\.?b\.?|nascid[oa]s?|nasceu|nascimento|data de nascimento)\b/i;

// Money has the same profile as an ordinary date: a price ("Budget: from €60")
// identifies nobody, and redacting it strips the context the LLM needs while
// protecting nothing. So amounts default OFF — EXCEPT where a nearby cue makes
// the amount personal (a salary, balance or income IS sensitive), mirroring the
// birth-date carve-out above.
const MONEY_CUE =
  /\b(salary|salaries|wage|wages|income|earnings|net pay|gross pay|payroll|bonus|pension|balance|savings|debt|loan|mortgage|rent|salário|salario|salarial|vencimento|rendimento|ordenado|remuneraç(ão|ao)|honorários|honorarios|saldo|dívida|divida|empréstimo|emprestimo|poupança|poupanca|renda|pensão|pensao)\b/i;

// True when `value` occurs anywhere in `text` preceded by a cue in the SAME
// sentence. The window is clipped at sentence boundaries: a plain 40-char
// lookback bleeds across sentences, so "…balance is €12,350. The dinner cost €45"
// wrongly treated €45 as sensitive by matching the previous sentence's cue.
function hasCueBefore(cue: RegExp, text: string, value: string): boolean {
  let idx = text.indexOf(value);
  while (idx !== -1) {
    const window = text.slice(Math.max(0, idx - 40), idx);
    const sameSentence = window.split(/[.!?;\n]/).pop() ?? window;
    if (cue.test(sameSentence)) return true;
    idx = text.indexOf(value, idx + 1);
  }
  return false;
}

function isBirthDate(text: string, value: string): boolean {
  return hasCueBefore(BIRTH_CUE, text, value);
}

function isSensitiveAmount(text: string, value: string): boolean {
  return hasCueBefore(MONEY_CUE, text, value);
}

export function applyContextDefaults(
  entities: SensitiveEntity[],
  text?: string
): SensitiveEntity[] {
  for (const e of entities) {
    if (e.category === 'DATE') {
      // Ordinary dates are context (default OFF); birth dates stay ON.
      if (!(text && isBirthDate(text, e.originalValue))) e.include = false;
    } else if (e.category === 'MONETARY') {
      // Prices/budgets are context (default OFF); salaries/balances stay ON.
      if (!(text && isSensitiveAmount(text, e.originalValue))) e.include = false;
    } else if (isContextualPlace(e.originalValue, e.category)) {
      e.include = false;
    }
  }
  return entities;
}
