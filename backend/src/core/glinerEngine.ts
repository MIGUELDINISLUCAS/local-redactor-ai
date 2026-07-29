import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { DetectionCategory } from './types';

// GLiNER zero-shot NER via onnxruntime-node (in-process, no Ollama, no LLM).
// ~1s inference, confidence-scored. See src/vendor/gliner (vendored MIT package).

type RawEntity = {
  originalValue: string;
  category: DetectionCategory;
  source: 'ner';
  occurrences: number;
  score?: number;
};

// Token-level GLiNER (knowledgator/gliner-pii-large, Apache-2.0, DeBERTa-v3).
// span_mode=token_level → NO span-width cap, so full multi-line addresses are
// caught whole (the old span model's max_width=12 could not). Runs in-process
// via onnxruntime-node; tokenizer loads LOCALLY (no HF hub call — fully offline).
const MODEL_DIR = process.env.GLINER_MODEL_DIR ?? path.join(process.cwd(), 'models/gliner-pii-large');
const MODEL_PATH = process.env.GLINER_MODEL_PATH ?? path.join(MODEL_DIR, 'model.onnx');
// Tokenizer is the model dir itself (contains tokenizer.json + configs), loaded
// offline via @xenova env.localModelPath (set in getModel()).
const TOKENIZER = process.env.GLINER_TOKENIZER ?? path.basename(MODEL_DIR);
// 0.4, NOT 0.5. The token decoder rejects a span if ANY inside token falls below
// the threshold, and long addresses always contain a weak token (a comma, a
// postcode fragment). At 0.5 a full address scoring 89% was still dropped in a
// short sentence, yet caught in a longer one — recall that swings with context.
// 0.4 clears that cliff; benchmarks show no extra noise. Recall matters more than
// a false positive here: a missed address leaks, a false positive is one untick.
const THRESHOLD = Number(process.env.GLINER_THRESHOLD ?? 0.4);
// Token-level model has no baked width cap; 100 matches gliner_config.json.
const MAX_WIDTH = Number(process.env.GLINER_MAX_WIDTH ?? 100);

// Entity types we ask for (zero-shot). Kept to the LEAN set the tuning validated
// (name + organization + one coarse address label) — this is deliberate:
//  - GLiNER shares ONE prompt across all labels, so every extra label competes
//    and degrades extraction. A bloated set even mangled plain names.
//  - Adding granular address sub-labels ('location street/city/zip') OR a bare
//    'location' FRAGMENTS the full-address span and tanks recall.
//  - Structured IDs (iban, credit card, passport, tax id) are left to the regex
//    layer — those are fixed patterns, and asking GLiNER for them measurably hurt
//    the labels above. (The regex patterns must actually exist: see ID gaps.)
//  - 'date of birth' EARNS its place: a date written in prose ("13 de julho de
//    1990") is semantic, not a pattern, so regex can't reach it — and measured
//    against the benchmark it costs nothing (names 4/4, addresses 4/4).
//  - 'location' is deliberately EXCLUDED despite standalone places going undetected:
//    adding it collapses full-address recall 4/4 → 1/4 (it competes with
//    'location address'). Full addresses outrank bare city names; a city gazetteer
//    is the way to cover those without touching this prompt.
const LABELS = ['name', 'organization', 'location address', 'date of birth'];

// Zero-shot GLiNER over-triggers on pronouns and generic nouns. Drop these
// outright (multilingual: EN/PT/ES/FR pronouns + generic org/person words).
const STOP = new Set(
  [
    'we', 'us', 'i', 'you', 'he', 'she', 'her', 'him', 'his', 'hers', 'they',
    'them', 'their', 'theirs', 'it', 'its', 'me', 'my', 'mine', 'our', 'ours',
    'here', 'there', 'herself', 'himself', 'themselves', 'ourselves', 'myself',
    'the company', 'company', 'business', 'locally', 'the client', 'client',
    'the account', 'account', 'the bank', 'someone', 'everyone', 'anyone',
    // PT / ES / FR pronouns + fillers
    'nós', 'nos', 'ela', 'ele', 'eles', 'elas', 'você', 'vocês', 'eu', 'tu',
    'su', 'sus', 'ella', 'él', 'ellos', 'nosotros', 'usted',
    'elle', 'lui', 'ils', 'elles', 'nous', 'vous', 'je',
  ].map((s) => s.toLowerCase())
);

// --- Generic-noun filter: keep only personally identifiable spans ------------
// GLiNER (zero-shot) confidently flags job titles, generic bodies and public
// institutions as person/organization ("Contabilista Certificado" 95%,
// "Administração Pública" 96%) — semantically org/person-like, but NOT PII.
// Confidence can't separate them (they score high), so we filter structurally.

// Strip diacritics + lowercase for lexicon matching.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Connective / structural tokens ignored when testing whether a span is made up
// ENTIRELY of generic words (articles, prepositions, conjunctions, annex refs,
// roman numerals — EN/PT/ES/FR).
const CONNECTORS = new Set([
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na',
  'nos', 'nas', 'ao', 'aos', 'the', 'of', 'and', 'for', 'la', 'el', 'los', 'las',
  'y', 'le', 'les', 'des', 'du', 'un', 'une', 'della', 'anexo', 'anexos', 'art',
  'artigo', 'artigos', 'clausula', 'n', 'nr', 'i', 'ii', 'iii', 'iv', 'v', 'vi',
]);

// Generic role / institution / legal-concept words. A PERSON/ORGANIZATION/
// LOCATION span composed ENTIRELY of these (plus connectors) is a title or
// generic body, not an identifiable name. Real names always carry a distinctive
// token (a surname, or an "Lda"/"SA" suffix) that isn't in this set.
const GENERIC = new Set([
  // roles / titles
  'administrador', 'administradora', 'administracao', 'administrativo', 'administrativa',
  'contabilista', 'contabilistica', 'contabilisticas', 'certificado', 'certificada',
  'destinatario', 'remetente', 'requerente', 'requerido', 'autor', 'reu', 'cliente',
  'clientes', 'fornecedor', 'gerente', 'diretor', 'diretora', 'direcao', 'presidente',
  'secretario', 'secretaria', 'funcionario', 'funcionaria', 'trabalhador', 'trabalhadora',
  'colaborador', 'colaboradora', 'representante', 'titular', 'portador', 'beneficiario',
  'responsavel', 'tecnico', 'tecnica', 'perito', 'testemunha', 'advogado', 'advogada',
  // entity / organisation generic
  'entidade', 'empregadora', 'empregador', 'empresa', 'empresas', 'empresarial',
  'empresariais', 'organizacao', 'sociedade', 'sociedades', 'societaria', 'societarias',
  'comercial', 'comerciais', 'publica', 'publico', 'publicas', 'publicos', 'tribunal',
  'supremo', 'suprema', 'instituicao', 'autoridade', 'orgao', 'departamento', 'servico',
  'servicos', 'ministerio', 'camara', 'junta', 'freguesia', 'conselho', 'comissao',
  'associacao', 'fundacao', 'grupo', 'firma', 'negocio', 'negocios', 'estabelecimento',
  // structural
  'parte', 'partes', 'seccao', 'capitulo', 'numero', 'pagina',
]);

// Generic word STEMS — so the filter generalises to inflections and derivatives
// we never listed ("administr" covers administração/administrador/administrativa;
// "requer" covers requerente/requerido/requerimento). GLiNER can't learn at
// runtime (frozen ONNX), but matching by stem makes one entry cover a whole word
// family. Min length 5 so a stem can't accidentally swallow a real surname.
const GENERIC_STEMS = [
  'administr', 'contabil', 'societ', 'empreg', 'organiz', 'empresa', 'empresari',
  'comerci', 'public', 'tribun', 'minister', 'instituic', 'autorid', 'departament',
  'associac', 'fundac', 'represent', 'secretari', 'funcionari', 'trabalh', 'colabor',
  'benefic', 'responsav', 'destinatari', 'requer', 'certific', 'fiscal', 'judicia',
  'jurisdic', 'notaria', 'registra', 'financ', 'juridic', 'coordena', 'gerenc',
  'presiden', 'consult', 'superviso',
];

// A single token is generic if it's an exact listed word or starts with a stem.
function isGenericToken(t: string): boolean {
  if (GENERIC.has(t)) return true;
  return GENERIC_STEMS.some((s) => t.startsWith(s));
}

// True when a person/org/location span is generic noise, not PII.
function isGenericNoise(value: string, category: DetectionCategory): boolean {
  if (category !== 'PERSON' && category !== 'ORGANIZATION' && category !== 'LOCATION') return false;
  // Proper names are capitalised; a span starting with a lowercase letter is a
  // common noun ("administração", "entidade empregadora"), never PII.
  if (/^\p{Ll}/u.test(value)) return true;
  // If every non-connector token is a generic role/institution word (or a
  // derivative of one), the whole span is a title or generic body — drop it.
  const tokens = value
    .split(/[^\p{L}\p{N}]+/u)
    .map(norm)
    .filter((t) => t && !CONNECTORS.has(t));
  if (!tokens.length) return true;
  return tokens.every(isGenericToken);
}

// Map GLiNER labels → our categories. (IDs are handled by the regex layer, not
// asked of GLiNER — see LABELS.) Anything unmapped falls through to PII.
const CAT: Record<string, DetectionCategory> = {
  name: 'PERSON', organization: 'ORGANIZATION', 'location address': 'ADDRESS',
  // → DATE, so applyContextDefaults' birth-date carve-out keeps it ticked ON
  // (ordinary dates default OFF). GLiNER only emits this label when the text says
  // born/nascido, which is exactly what that cue matches.
  'date of birth': 'DATE',
};

// Both the vendored gliner build and @xenova/transformers are ESM-only. We
// compile to CommonJS, and TypeScript rewrites a plain `await import()` into
// require() — which cannot load ESM on the Node 20 that Electron bundles, so
// the packaged app failed with ERR_REQUIRE_ESM and silently fell back to regex
// (it only worked in dev because newer standalone Node allows require(esm)).
// Building the import via Function keeps it a real dynamic import after
// compilation. Specifiers are absolute file:// URLs so relative paths — and
// Windows backslashes/spaces — resolve correctly.
const esmImport: (specifier: string) => Promise<any> =
  new Function('s', 'return import(s)') as (s: string) => Promise<any>;

let modelPromise: Promise<any> | null = null;
async function getModel(): Promise<any> {
  if (!modelPromise) {
    modelPromise = (async () => {
      // Imported lazily so onnxruntime-node only loads when this engine is used.
      const glinerUrl = pathToFileURL(path.join(__dirname, '..', 'vendor', 'gliner', 'gliner.mjs')).href;
      const { Gliner } = await esmImport(glinerUrl);
      // Load the tokenizer from the local model dir — NO network call to the HF
      // hub (privacy: nothing leaves the device, works fully offline).
      const { env } = await esmImport(pathToFileURL(require.resolve('@xenova/transformers')).href);
      env.localModelPath = path.dirname(MODEL_DIR);
      const g = new Gliner({
        tokenizerPath: TOKENIZER,
        onnxSettings: { modelPath: MODEL_PATH, executionProvider: 'cpu' },
        transformersSettings: { allowLocalModels: true, useBrowserCache: false },
        maxWidth: MAX_WIDTH,
        // Token-level DeBERTa-v3 model: no width cap; needs metaspace (▁) word
        // encoding for correct SentencePiece subword ids.
        modelType: 'token-level',
        metaspace: true,
      });
      await g.initialize();
      console.log(`✓ GLiNER token-level model loaded (${path.basename(MODEL_DIR)}).`);
      return g;
    })();
  }
  return modelPromise;
}

export function glinerModelPresent(): boolean {
  try {
    return fs.existsSync(MODEL_PATH);
  } catch {
    return false;
  }
}

export async function warmGliner(): Promise<void> {
  if (!glinerModelPresent()) {
    console.log(`ℹ GLiNER model not found at ${MODEL_PATH} — name detection will fall back to regex only.`);
    return;
  }
  try {
    await getModel();
  } catch (e) {
    console.log('ℹ GLiNER failed to initialise — regex-only until fixed:', (e as Error).message);
  }
}

// The encoder caps at ~768 tokens (gliner_config max_len), so long text is split
// on paragraph/line boundaries (a single oversized paragraph is hard-cut) into
// pieces safely under that limit. BATCH kept modest — this is DeBERTa-v3-LARGE
// (~3x the old base model), so large batches spike memory.
const CHUNK_CHARS = Number(process.env.GLINER_CHUNK_CHARS ?? 1800);
const CHUNK_OVERLAP = Number(process.env.GLINER_CHUNK_OVERLAP ?? 250);
const BATCH = Number(process.env.GLINER_BATCH ?? 4);

function chunk(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (const para of text.split(/\n{2,}/)) {
    if (para.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      for (const line of para.split('\n')) {
        if (line.length > max) {
          for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
        } else if ((cur + '\n' + line).length > max && cur) {
          out.push(cur); cur = line;
        } else {
          cur = cur ? cur + '\n' + line : line;
        }
      }
    } else if ((cur + '\n\n' + para).length > max && cur) {
      out.push(cur); cur = para;
    } else {
      cur = cur ? cur + '\n\n' + para : para;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Add real preceding text to each window after the first. This prevents a name
// or postal address split by a hard boundary from disappearing from both model
// calls. Results are de-duplicated by value/category below.
export function glinerWindows(text: string, max = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const base = chunk(text, max);
  if (base.length <= 1) return base;
  return base.map((part, i) => (i === 0 ? part : base[i - 1].slice(-overlap) + part));
}

// Detect entities. Short text is one pass (~1s); long text is chunked and run in
// small batches. De-duplicates by value+category.
export async function detectWithGliner(
  text: string,
  onProgress?: (done: number, total: number) => void
): Promise<RawEntity[]> {
  const g = await getModel();
  const chunks = glinerWindows(text);
  const seen = new Set<string>();
  const out: RawEntity[] = [];
  let done = 0;
  onProgress?.(0, chunks.length);
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const res: Array<Array<{ spanText: string; label: string; score?: number }>> =
      // flatNer:true → non-overlapping spans only. With nested spans allowed the
      // model emits junk supersets alongside the real hit ("Eleanor Whitfield"
      // AND "Eleanor Whitfield lives"), which surface as bogus rows in review.
      // Benchmarks show flat gives identical recall (4/4 names, 4/4 addresses).
      await g.inference({ texts: batch, entities: LABELS, threshold: THRESHOLD, flatNer: true });
    for (const chunkSpans of res) {
      for (const e of chunkSpans ?? []) {
        const value = (e.spanText || '').trim();
        if (!value) continue;
        if (STOP.has(value.toLowerCase())) continue; // pronouns / generic noise
        const category = CAT[e.label] ?? 'PII';
        if (isGenericNoise(value, category)) continue; // job titles / public bodies — not PII
        const key = `${category}::${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          originalValue: value,
          category,
          source: 'ner',
          occurrences: text.split(value).length - 1,
          score: typeof e.score === 'number' ? e.score : undefined,
        });
      }
    }
    done += batch.length;
    onProgress?.(done, chunks.length);
  }
  return out;
}
