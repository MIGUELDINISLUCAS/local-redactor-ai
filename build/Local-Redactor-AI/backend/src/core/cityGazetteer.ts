import { DetectionCategory } from './types';

// Curated city / town gazetteer → deterministic LOCATION detection.
//
// WHY a gazetteer instead of just asking the model? GLiNER has a 'location'
// label, but adding it collapses full-address recall from 4/4 to 1/4 — it
// competes with 'location address' for the same tokens. Full addresses matter
// more than bare city names, so places are covered here instead: deterministic,
// instant, and it costs the model nothing. (Same reasoning as ptGazetteer, which
// covers institutions the NER misses.)
//
// A city inside a full address is harmless: the ADDRESS span is longer, and
// anonymise replaces longest-first, so the address swallows it. This rule earns
// its keep on STANDALONE mentions ("nasceu em Viseu"), which nothing else caught.
//
// CASE-SENSITIVE by design (see cityRules). Many Portuguese place names are also
// ordinary words — porto (harbour), faro (lighthouse), guarda (guard), maia,
// covilhã — so matching case-insensitively would fire on everyday prose.
// Names that are ALSO common English words when capitalised at a sentence start
// ("Nice", "Reading", "Bath") are deliberately EXCLUDED: the false-positive rate
// isn't worth it.
const CITIES: string[] = [
  // --- Portugal: district capitals + islands -------------------------------
  'Lisboa', 'Lisbon', 'Porto', 'Oporto', 'Braga', 'Coimbra', 'Faro', 'Setúbal',
  'Aveiro', 'Leiria', 'Viseu', 'Évora', 'Beja', 'Guarda', 'Castelo Branco',
  'Portalegre', 'Santarém', 'Viana do Castelo', 'Vila Real', 'Bragança',
  'Funchal', 'Ponta Delgada', 'Angra do Heroísmo', 'Horta',
  // --- Portugal: major municipalities / towns ------------------------------
  'Sintra', 'Cascais', 'Oeiras', 'Amadora', 'Almada', 'Matosinhos', 'Gondomar',
  'Vila Nova de Gaia', 'Guimarães', 'Barcelos', 'Famalicão', 'Vila Nova de Famalicão',
  'Maia', 'Loures', 'Odivelas', 'Seixal', 'Barreiro', 'Montijo', 'Torres Vedras',
  'Caldas da Rainha', 'Figueira da Foz', 'Covilhã', 'Fundão', 'Tomar', 'Abrantes',
  'Elvas', 'Olhão', 'Portimão', 'Lagos', 'Loulé', 'Albufeira', 'Tavira', 'Espinho',
  'Póvoa de Varzim', 'Vila do Conde', 'Valongo', 'Paredes', 'Penafiel', 'Chaves',
  'Lamego', 'Mirandela', 'Marco de Canaveses', 'Santa Maria da Feira', 'Ovar',
  'Estoril', 'Queluz', 'Sesimbra', 'Palmela', 'Alcochete', 'Mafra', 'Ericeira',
  // --- UK / Ireland --------------------------------------------------------
  'London', 'Manchester', 'Birmingham', 'Leeds', 'Liverpool', 'Sheffield',
  'Bristol', 'Glasgow', 'Edinburgh', 'Cardiff', 'Belfast', 'Newcastle',
  'Nottingham', 'Leicester', 'Southampton', 'Brighton', 'Oxford', 'Cambridge',
  'Dublin', 'Cork', 'Galway',
  // --- Spain ---------------------------------------------------------------
  'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Seville', 'Zaragoza', 'Málaga',
  'Bilbao', 'Murcia', 'Granada', 'Alicante', 'Córdoba', 'Valladolid', 'Vigo',
  'San Sebastián', 'Salamanca', 'Santiago de Compostela', 'Badajoz',
  // --- France --------------------------------------------------------------
  'Paris', 'Lyon', 'Marseille', 'Toulouse', 'Bordeaux', 'Nantes', 'Lille',
  'Strasbourg', 'Montpellier', 'Rennes', 'Grenoble', 'Toulon', 'Cannes',
  // --- Rest of Europe / major world ---------------------------------------
  'Berlin', 'Munich', 'München', 'Hamburg', 'Frankfurt', 'Cologne', 'Köln',
  'Stuttgart', 'Düsseldorf', 'Rome', 'Roma', 'Milan', 'Milano', 'Naples',
  'Napoli', 'Turin', 'Torino', 'Florence', 'Firenze', 'Venice', 'Venezia',
  'Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Brussels', 'Bruxelles',
  'Antwerp', 'Vienna', 'Wien', 'Zurich', 'Zürich', 'Geneva', 'Genève', 'Basel',
  'Luxembourg', 'Copenhagen', 'Stockholm', 'Oslo', 'Helsinki', 'Warsaw',
  'Kraków', 'Prague', 'Praha', 'Budapest', 'Bucharest', 'Athens', 'Thessaloniki',
  'Sofia', 'Zagreb', 'Ljubljana', 'Bratislava', 'Tallinn', 'Riga', 'Vilnius',
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Philadelphia', 'Boston',
  'San Francisco', 'Seattle', 'Denver', 'Atlanta', 'Miami', 'Dallas',
  'Washington DC', 'Toronto', 'Montreal', 'Vancouver', 'Ottawa',
  'São Paulo', 'Rio de Janeiro', 'Brasília', 'Belo Horizonte', 'Salvador',
  'Buenos Aires', 'Santiago', 'Bogotá', 'Lima', 'Mexico City', 'Ciudad de México',
  'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Auckland', 'Wellington',
  'Tokyo', 'Osaka', 'Kyoto', 'Seoul', 'Beijing', 'Shanghai', 'Hong Kong',
  'Singapore', 'Bangkok', 'Mumbai', 'Delhi', 'Bangalore', 'Dubai', 'Abu Dhabi',
  'Doha', 'Istanbul', 'Tel Aviv', 'Cairo', 'Johannesburg', 'Cape Town', 'Nairobi',
  'Luanda', 'Maputo', 'Bissau', 'São Tomé', 'Macau',
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function alternation(terms: string[], flags: string): RegExp {
  // Longest first so "Vila Nova de Gaia" wins over a shorter name inside it.
  const body = terms.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  // Letter/digit lookarounds (not \b) so accented names match cleanly — and so
  // "Porto" does NOT match inside "Portugal".
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, flags);
}

// Case-SENSITIVE ('gu', no 'i'): place names double as ordinary Portuguese words
// (porto/faro/guarda), so only the capitalised proper-noun form should match.
export function cityRules(): Array<[DetectionCategory, RegExp]> {
  return [['LOCATION', alternation(CITIES, 'gu')]];
}

const CITY_LOOKUP = new Set(CITIES.map((c) => c.toLowerCase()));

// Is this value a KNOWN city from the curated list? Used to default cities to
// not-anonymised (like countries): a gazetteer hit is definitionally a place, so
// it's context rather than a private identifier. Checked BY VALUE, deliberately —
// a LOCATION we can't find here may be a misclassified person name ("Guy"), which
// must stay anonymised. That distinction is the whole point.
export function isGazetteerCity(value: string): boolean {
  return CITY_LOOKUP.has(value.trim().toLowerCase());
}
