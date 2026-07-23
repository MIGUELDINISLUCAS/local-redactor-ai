import fs from 'fs';

export interface ParseResult {
  text: string;
  filename: string;
  fileType: string;
  wordCount: number;
  warnings: string[];
}

export function parseTxt(filePath: string, filename: string): ParseResult {
  const text = fs.readFileSync(filePath, 'utf-8');
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { text, filename, fileType: 'txt', wordCount, warnings: [] };
}
