import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './auth.js';

export const storageRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.join(__dirname, 'uploads');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const safeSegment = (part) => (part === '..' ? '_' : part.replace(/[^a-zA-Z0-9._-]/g, '-'));

// POST /api/storage/upload — multipart: bucket, path, file
storageRouter.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const bucket = safeSegment(req.body?.bucket || 'files');
    const rel = String(req.body?.path || '').split('/').map(safeSegment).join('/');
    if (!req.file || !rel) return res.status(400).json({ data: { path: null }, error: { message: 'No file or path provided.' } });

    const target = path.join(UPLOAD_DIR, bucket, rel);
    if (!target.startsWith(UPLOAD_DIR + path.sep)) {
      return res.status(400).json({ data: { path: null }, error: { message: 'Invalid path.' } });
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, req.file.buffer);

    res.json({ data: { path: `${bucket}/${rel}` }, error: null });
  } catch (err) {
    console.error('[storage] upload failed', err);
    res.status(500).json({ data: { path: null }, error: { message: 'The file could not be uploaded. Please try again.' } });
  }
});

// POST /api/storage/signed-url — local dev: files are served statically.
storageRouter.post('/signed-url', requireAuth, (req, res) => {
  const bucket = safeSegment(req.body?.bucket || 'files');
  const rel = String(req.body?.path || '').split('/').map(safeSegment).join('/');
  res.json({ data: { signedUrl: `/uploads/${bucket}/${rel}` }, error: null });
});

// POST /api/storage/remove — body: { bucket, paths: [] }
storageRouter.post('/remove', requireAuth, (req, res) => {
  try {
    const bucket = safeSegment(req.body?.bucket || 'files');
    for (const rel of req.body?.paths || []) {
      const safeRel = String(rel).split('/').map(safeSegment).join('/');
      const target = path.join(UPLOAD_DIR, bucket, safeRel);
      if (target.startsWith(UPLOAD_DIR) && fs.existsSync(target)) fs.unlinkSync(target);
    }
    res.json({ data: null, error: null });
  } catch (err) {
    console.error('[storage] remove failed', err);
    res.status(500).json({ data: null, error: { message: 'Could not remove the file.' } });
  }
});

// Dev-only: create the token so file URLs work immediately.
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });