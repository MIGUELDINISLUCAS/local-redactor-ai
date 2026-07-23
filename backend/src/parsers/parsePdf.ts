import fs from 'fs';
import pdf from 'pdf-parse';
import type { ParseResult } from './parseTxt';

export async function parsePdf(filePath: string, filename: string): Promise<ParseResult> {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);
  const warnings: string[] = [];
  if (!data.text.trim()) warnings.push('PDF appears to contain no extractable text (may be scanned image).');
  const wordCount = data.text.split(/\s+/).filter(Boolean).length;
  return { text: data.text, filename, fileType: 'pdf', wordCount, warnings };
}
