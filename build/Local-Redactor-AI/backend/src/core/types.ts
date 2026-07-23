export type DetectionCategory =
  | 'EMAIL'
  | 'PHONE'
  | 'URL'
  | 'IP_ADDRESS'
  | 'UUID'
  | 'IBAN'
  | 'SWIFT_BIC'
  | 'CREDIT_CARD'
  | 'CRYPTO_WALLET'
  | 'CRYPTO_TX'
  | 'FILE_PATH'
  | 'DATE'
  | 'MONETARY'
  | 'TAX_ID'
  | 'REGISTRATION'
  | 'POSTAL_CODE'
  | 'PERSON'
  | 'ORGANIZATION'
  | 'ADDRESS'
  | 'LOCATION'
  | 'PII'
  | 'CUSTOM';

export type DetectionSource = 'regex' | 'ner' | 'manual';

export interface SensitiveEntity {
  id: string;
  originalValue: string;
  category: DetectionCategory;
  source: DetectionSource;
  occurrences: number;
  placeholder: string;
  include: boolean;
  score?: number; // 0-1 model confidence (GLiNER/fast mode only)
}

export interface PlaceholderMapping {
  placeholder: string;
  originalValue: string;
  category: DetectionCategory;
}

export interface PlaceholderRegistry {
  entries: Map<string, PlaceholderMapping>; // placeholder -> mapping
  byValue: Map<string, string>;             // originalValue -> placeholder
  counters: Map<DetectionCategory, number>;
}

export interface AnonymisationResult {
  anonymisedText: string;
  entities: SensitiveEntity[];
  mappings: PlaceholderMapping[];
  // Ticked values that could NOT be removed from the text. Must be empty; a
  // non-empty list means the caller has to block the send rather than leak.
  unreplaced?: string[];
}

export interface RestorationWarning {
  placeholder: string;
  reason: 'not_found_in_registry' | 'malformed_placeholder' | 'partially_restored';
}

export interface RestorationResult {
  restoredText: string;
  warnings: RestorationWarning[];
  restoredCount: number;
  unresolvedCount: number;
}

export interface LocalLearningRule {
  id: string;
  pattern: string;           // regex pattern string
  category: DetectionCategory;
  label?: string;
  createdAt: string;
}
