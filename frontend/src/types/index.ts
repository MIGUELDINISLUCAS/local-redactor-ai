export type DetectionCategory =
  | 'EMAIL' | 'PHONE' | 'URL' | 'IP_ADDRESS' | 'UUID'
  | 'IBAN' | 'SWIFT_BIC' | 'CREDIT_CARD' | 'CRYPTO_WALLET'
  | 'CRYPTO_TX' | 'FILE_PATH' | 'DATE' | 'MONETARY' | 'TAX_ID'
  | 'REGISTRATION' | 'POSTAL_CODE'
  | 'PERSON' | 'ORGANIZATION' | 'ADDRESS' | 'LOCATION' | 'PII' | 'CUSTOM';

export type AppMode = 'private-local' | 'approved-external';

export type WorkflowStep =
  | 'mode'
  | 'input'
  | 'detect'
  | 'review'
  | 'anonymise'
  | 'process'
  | 'restore'
  | 'export';

export interface SensitiveEntity {
  id: string;
  originalValue: string;
  category: DetectionCategory;
  source: 'regex' | 'ner' | 'manual';
  occurrences: number;
  placeholder: string;
  include: boolean;
}

export interface PlaceholderMapping {
  placeholder: string;
  originalValue: string;
  category: DetectionCategory;
}

export interface FileMetadata {
  filename: string;
  fileType: string;
  wordCount: number;
  warnings: string[];
}

export interface RestorationWarning {
  placeholder: string;
  reason: 'not_found_in_registry' | 'malformed_placeholder' | 'partially_restored';
}

export interface AppState {
  mode: AppMode | null;
  step: WorkflowStep;
  inputText: string;
  fileMetadata: FileMetadata | null;
  entities: SensitiveEntity[];
  mappings: PlaceholderMapping[];
  anonymisedText: string;
  userInstruction: string;
  finalPrompt: string;
  llmOutput: string;
  restoredText: string;
  restorationWarnings: RestorationWarning[];
}
