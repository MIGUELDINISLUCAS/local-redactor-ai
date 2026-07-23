import { DetectionCategory } from './types';

// Curated Portuguese institutions, funders and public bodies. These are the
// entities the open-ended NER model tends to miss — short acronyms (ICA, SPA,
// RTP) and fixed multi-word names — so we catch them deterministically here and
// tag them ORGANIZATION. Included by default; the user can untick any that are
// mere context in a given message. Keep entries specific enough to avoid noise.
const PT_INSTITUTIONS = [
  // Film / audiovisual / culture funders (the user's domain)
  'Instituto do Cinema e do Audiovisual', 'ICA',
  'Fundo Cultural da SPA', 'Sociedade Portuguesa de Autores', 'SPA',
  'GDA', 'Gestão dos Direitos dos Artistas',
  'Europa Criativa', 'Creative Europe', 'MEDIA',
  'Direção-Geral das Artes', 'Direcção-Geral das Artes', 'DGArtes',
  'RTP', 'Rádio e Televisão de Portugal', 'SIC', 'TVI', 'Antena 1', 'Antena 2', 'Antena 3',
  'Cinemateca Portuguesa', 'Fundação Calouste Gulbenkian', 'Gulbenkian',
  // Research / innovation / economic agencies
  'FCT', 'Fundação para a Ciência e a Tecnologia', 'ANI',
  'Agência Nacional de Inovação', 'IAPMEI', 'AICEP', 'Turismo de Portugal',
  'Portugal 2020', 'Portugal 2030', 'PRR', 'Plano de Recuperação e Resiliência',
  // Public administration / regulators
  'Autoridade Tributária', 'Autoridade Tributária e Aduaneira', 'Finanças',
  'Segurança Social', 'IEFP', 'ACT', 'ASAE', 'ANACOM', 'ERSE', 'CMVM',
  'Banco de Portugal', 'Instituto de Registos e Notariado', 'IRN',
  'Conservatória do Registo Comercial', 'Conservatória do Registo Predial',
  'INPI', 'Instituto Nacional da Propriedade Industrial',
  'Câmara Municipal', 'Junta de Freguesia', 'Ordem dos Advogados',
  // Common Portuguese retail / commercial banks
  'Millennium BCP', 'Banco Millennium BCP', 'Caixa Geral de Depósitos', 'CGD',
  'Novo Banco', 'Banco BPI', 'Santander Totta', 'Banco Santander',
  'Crédito Agrícola', 'Bankinter', 'Montepio', 'ActivoBank',
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function alternation(terms: string[], flags: string): RegExp {
  // Longest first so a multi-word name wins over a bare acronym it contains.
  const body = terms.sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  // Letter/digit lookarounds (not \b) so accented names match cleanly.
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, flags);
}

// Two rules: short ALL-CAPS acronyms are matched CASE-SENSITIVELY (so "MEDIA",
// "ACT", "SPA" don't fire on the everyday words media/act/spa), while proper
// multi-word names are case-insensitive.
export function institutionRules(): Array<[DetectionCategory, RegExp]> {
  const acronyms = PT_INSTITUTIONS.filter((t) => /^[A-Z][A-Z0-9]{1,6}$/.test(t));
  const names = PT_INSTITUTIONS.filter((t) => !acronyms.includes(t));
  return [
    ['ORGANIZATION', alternation([...acronyms], 'gu')],
    ['ORGANIZATION', alternation([...names], 'giu')],
  ];
}
