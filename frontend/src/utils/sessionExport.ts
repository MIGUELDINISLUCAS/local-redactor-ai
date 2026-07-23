import type { ChatMessage } from '../store/chatStore';
import { downloadRecord, type DocxSection } from './api';

function modeLabel(mode: string): string {
  return mode === 'approved-external' ? 'Approved External' : 'Private Local';
}

// Build one audit document covering every exchange in the session.
export function exportSession(messages: ChatMessage[]): void {
  const records = messages.filter((m) => m.record).map((m) => m.record!);
  if (records.length === 0) return;

  const sections: DocxSection[] = [];
  records.forEach((r, i) => {
    sections.push({
      heading: `Exchange ${i + 1} — ${modeLabel(r.mode)} — ${new Date(r.timestamp).toLocaleString()}`,
      body: '',
    });
    sections.push({ heading: '1. Original input (stayed on your device)', body: r.original });
    sections.push({ heading: '2. Anonymised prompt (sent to the LLM)', body: r.anonymisedPrompt });
    sections.push({ heading: '3. LLM response (anonymised, as received)', body: r.llmOutput });
    sections.push({ heading: '4. Restored output (de-anonymised locally)', body: r.restoredOutput });
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadRecord('Local Redactor AI — Session Record', sections, `redactor-session-${stamp}`);
}

export function sessionHasRecords(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.record);
}
