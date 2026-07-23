import multer from 'multer';
import path from 'path';
import os from 'os';

export const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMime = [
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown',
      'text/csv',
      'application/octet-stream', // browsers/uploaders often send this for .docx
    ];
    // Accept by extension too — the MIME type is unreliable (Word docs commonly
    // arrive as application/octet-stream), so the filename is the safer signal.
    const allowedExt = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.csv'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allowedMime.includes(file.mimetype) || allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.originalname || file.mimetype}`));
    }
  },
});
