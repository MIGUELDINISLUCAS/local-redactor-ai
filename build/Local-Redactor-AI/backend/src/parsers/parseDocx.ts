import mammoth from 'mammoth';
import type { ParseResult } from './parseTxt';

export async function parseDocx(filePath: string, filename: string): Promise<ParseResult> {
  const result = await mammoth.extractRawText({ path: filePath });
  const warnings = result.messages
    .filter((m) => m.type === 'warning')
    .map((m) => m.message);
  const wordCount = result.value.split(/\s+/).filter(Boolean).length;
  return { text: result.value, filename, fileType: 'docx', wordCount, warnings };
}
