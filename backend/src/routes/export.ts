import { Router, Request, Response } from 'express';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Footer } from 'docx';

const CONFIDENTIAL_NOTICE =
  'CONFIDENTIAL — contains original sensitive data. Store securely. Generated locally by Local Redactor AI; not transmitted.';

export const exportRouter = Router();

interface Section {
  heading: string;
  body: string;
}

function sanitizeFilename(name: string): string {
  const base = (name || 'export').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`;
}

function textToParagraphs(text: string): Paragraph[] {
  return text.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] }));
}

async function buildDocxBuffer(opts: {
  title?: string;
  text?: string;
  sections?: Section[];
}): Promise<Buffer> {
  const children: Paragraph[] = [];

  if (opts.title) {
    children.push(new Paragraph({ text: opts.title, heading: HeadingLevel.HEADING_1 }));
  }

  if (opts.sections?.length) {
    for (const s of opts.sections) {
      children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2 }));
      children.push(...textToParagraphs(s.body ?? ''));
      children.push(new Paragraph({ children: [] })); // spacer
    }
  } else {
    children.push(...textToParagraphs(opts.text ?? ''));
  }

  const footer = new Footer({
    children: [
      new Paragraph({
        children: [new TextRun({ text: CONFIDENTIAL_NOTICE, italics: true, size: 16, color: '999999' })],
      }),
    ],
  });

  const doc = new Document({
    sections: [{ properties: {}, footers: { default: footer }, children }],
  });
  return Packer.toBuffer(doc);
}

function sendDocx(res: Response, buffer: Buffer, filename: string) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);
  res.send(buffer);
}

// POST /api/export/docx — plain text -> .docx (kept for simple exports).
exportRouter.post('/docx', async (req: Request, res: Response) => {
  const { text, filename } = req.body as { text?: string; filename?: string };
  if (typeof text !== 'string') {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const buffer = await buildDocxBuffer({ text });
  sendDocx(res, buffer, filename ?? 'export');
});

// POST /api/export/record — structured audit record with headed sections.
exportRouter.post('/record', async (req: Request, res: Response) => {
  const { title, sections, filename } = req.body as {
    title?: string;
    sections?: Section[];
    filename?: string;
  };
  if (!Array.isArray(sections) || sections.length === 0) {
    res.status(400).json({ error: 'sections are required' });
    return;
  }
  const buffer = await buildDocxBuffer({ title: title ?? 'Local Redactor AI — Record', sections });
  sendDocx(res, buffer, filename ?? 'redactor-record');
});
