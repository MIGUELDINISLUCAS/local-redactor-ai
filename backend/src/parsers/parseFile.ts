import fs from 'fs';
import path from 'path';
import { parseTxt, type ParseResult } from './parseTxt';
import { parsePdf } from './parsePdf';
import { parseDocx } from './parseDocx';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const SUPPORTED_MIME: Record<string, string> = {
  'text/plain':       'txt',
  'application/pdf':  'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/markdown':    'txt',
  'text/csv':         'txt',
};

export async function parseFile(
  filePath: string,
  mimeType: string,
  originalFilename: string
): Promise<ParseResult> {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB.`);
    }

    // Resolve by MIME first, then fall back to the filename extension — Word docs
    // frequently arrive as application/octet-stream, so the extension is safer.
    const byExt: Record<string, string> = {
      '.pdf': 'pdf', '.docx': 'docx', '.txt': 'txt', '.md': 'txt', '.markdown': 'txt', '.csv': 'txt',
    };
    const ext = SUPPORTED_MIME[mimeType] || byExt[path.extname(originalFilename || '').toLowerCase()];
    if (!ext) {
      throw new Error(`Unsupported file type: ${originalFilename || mimeType}. Supported: TXT, PDF, DOCX, Markdown, CSV.`);
    }

    switch (ext) {
      case 'pdf':  return await parsePdf(filePath, originalFilename);
      case 'docx': return await parseDocx(filePath, originalFilename);
      default:     return parseTxt(filePath, originalFilename);
    }
  } finally {
    // Clean up temp file after extraction
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  }
}
