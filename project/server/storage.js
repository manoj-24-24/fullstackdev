import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './auth.js';
import { pool } from './db.js';

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

    // Durable copy: the database holds the bytes so the file survives
    // redeploys and exists on every instance (disk is ephemeral on hosts).
    if (pool) {
      await pool.query(
        'INSERT INTO files_blob (id, bucket, path, mime, size, data) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE mime = VALUES(mime), size = VALUES(size), data = VALUES(data)',
        [`${bucket}/${rel}`, bucket, rel, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer]
      );
    }

    res.json({ data: { path: `${bucket}/${rel}` }, error: null });
  } catch (err) {
    console.error('[storage] upload failed', err);
    res.status(500).json({ data: { path: null }, error: { message: 'The file could not be uploaded. Please try again.' } });
  }
});

// Durable serving: serve an upload from disk, falling back to the database
// copy when the disk file is missing (fresh deploy / another instance).
export async function serveUpload(req, res) {
  const rel = String(req.path || '').replace(/^\/uploads\//, '');
  const safeRel = rel.split('/').map(safeSegment).join('/');
  const diskPath = path.join(UPLOAD_DIR, safeRel);
  if (diskPath.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(diskPath)) {
    return res.sendFile(diskPath);
  }
  if (!pool) return res.status(404).json({ error: 'Not found' });
  try {
    const [rows] = await pool.query('SELECT mime, data FROM files_blob WHERE id = ? LIMIT 1', [safeRel]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', rows[0].mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(rows[0].data);
  } catch (err) {
    console.error('[storage] db serve failed', err);
    return res.status(500).json({ error: 'File unavailable' });
  }
}

// POST /api/storage/signed-url — returns the static path for an upload.
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
      if (pool) void pool.query('DELETE FROM files_blob WHERE id = ?', [`${bucket}/${safeRel}`]);
    }
    res.json({ data: null, error: null });
  } catch (err) {
    console.error('[storage] remove failed', err);
    res.status(500).json({ data: null, error: { message: 'Could not remove the file.' } });
  }
});

// Dev-only: create the token so file URLs work immediately.
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });