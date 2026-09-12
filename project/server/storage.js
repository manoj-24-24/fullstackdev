import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './auth.js';
import { pool } from './db.js';
import { cloudinaryEnabled, cloudinaryPut, cloudinarySignedUrl, cloudinaryDelete } from './cloudinary.js';
import { r2Enabled, r2Put, r2SignedUrl, r2Delete } from './r2.js';

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

    // Tier 1: Cloudinary (~25 GB free) when configured — the DB keeps only
    // metadata plus a pointer row. Tier 2: R2 (same idea, DB copy fallback).
    // Tier 3: neither configured — the database copy IS the storage.
    let cloud = null;
    if (cloudinaryEnabled()) {
      try {
        cloud = await cloudinaryPut(`${bucket}/${rel}`, req.file.buffer, req.file.mimetype || 'application/octet-stream');
      } catch (err) {
        console.error('[storage] Cloudinary upload failed — keeping DB copy instead', err);
      }
    } else if (r2Enabled()) {
      // Primary path on Render: store bytes in Cloudflare R2 (10 GB free),
      // keeping the database small. The disk copy is just a dev cache.
      try {
        await r2Put(`${bucket}/${rel}`, req.file.buffer, req.file.mimetype || 'application/octet-stream');
      } catch (err) {
        console.error('[storage] R2 upload failed — keeping DB copy instead', err);
      }
    }

    if (pool) {
      if (cloud) {
        await pool.query(
          'INSERT INTO files_blob (id, bucket, path, mime, size, data, cloud_public_id, cloud_resource_type) VALUES (?, ?, ?, ?, ?, NULL, ?, ?) ON DUPLICATE KEY UPDATE mime = VALUES(mime), size = VALUES(size), data = NULL, cloud_public_id = VALUES(cloud_public_id), cloud_resource_type = VALUES(cloud_resource_type)',
          [`${bucket}/${rel}`, bucket, rel, req.file.mimetype || 'application/octet-stream', req.file.size, cloud.publicId, cloud.resourceType]
        );
      } else {
        // Durable fallback copy: the database holds the bytes when no cloud
        // storage is configured (local dev) or when the cloud write just failed.
        await pool.query(
          'INSERT INTO files_blob (id, bucket, path, mime, size, data) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE mime = VALUES(mime), size = VALUES(size), data = VALUES(data)',
          [`${bucket}/${rel}`, bucket, rel, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer]
        );
      }
    }

    res.json({ data: { path: `${bucket}/${rel}` }, error: null });
  } catch (err) {
    console.error('[storage] upload failed', err);
    res.status(500).json({ data: { path: null }, error: { message: 'The file could not be uploaded. Please try again.' } });
  }
});

// Durable serving: serve an upload from disk, falling back to the database
// copy when the disk file is missing (fresh deploy / another instance).
// Cloud-backed files redirect to a freshly minted signed URL.
export async function serveUpload(req, res) {
  const rel = String(req.path || '').replace(/^\/uploads\//, '');
  const safeRel = rel.split('/').map(safeSegment).join('/');
  const diskPath = path.join(UPLOAD_DIR, safeRel);
  if (diskPath.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(diskPath)) {
    return res.sendFile(diskPath);
  }
  if (!pool) return res.status(404).json({ error: 'Not found' });
  try {
    const [rows] = await pool.query('SELECT mime, data, cloud_public_id, cloud_resource_type FROM files_blob WHERE id = ? LIMIT 1', [safeRel]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].cloud_public_id) {
      return res.redirect(cloudinarySignedUrl(rows[0].cloud_public_id, rows[0].cloud_resource_type || 'raw', 3600, rows[0].cloud_resource_type === 'image'));
    }
    res.setHeader('Content-Type', rows[0].mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(rows[0].data);
  } catch (err) {
    console.error('[storage] db serve failed', err);
    return res.status(500).json({ error: 'File unavailable' });
  }
}

// POST /api/storage/signed-url — a short-lived signed URL for cloud-stored
// files (Cloudinary first, then R2), else the static path served by this
// process (disk first, database fallback).
storageRouter.post('/signed-url', requireAuth, async (req, res) => {
  const bucket = safeSegment(req.body?.bucket || 'files');
  const rel = String(req.body?.path || '').split('/').map(safeSegment).join('/');
  if (cloudinaryEnabled() && pool) {
    try {
      const [rows] = await pool.query('SELECT cloud_public_id, cloud_resource_type FROM files_blob WHERE id = ? LIMIT 1', [`${bucket}/${rel}`]);
      if (rows.length && rows[0].cloud_public_id) {
        const resourceType = rows[0].cloud_resource_type || 'raw';
        const url = cloudinarySignedUrl(rows[0].cloud_public_id, resourceType, 3600, resourceType === 'image');
        return res.json({ data: { signedUrl: url }, error: null });
      }
    } catch (err) {
      console.error('[storage] Cloudinary sign failed — serving from local/DB instead', err);
    }
  }
  if (r2Enabled()) {
    try {
      const url = await r2SignedUrl(`${bucket}/${rel}`, 3600);
      return res.json({ data: { signedUrl: url }, error: null });
    } catch (err) {
      console.error('[storage] R2 sign failed — serving from local/DB instead', err);
    }
  }
  return res.json({ data: { signedUrl: `/uploads/${bucket}/${rel}` }, error: null });
});

// POST /api/storage/remove — body: { bucket, paths: [] }
storageRouter.post('/remove', requireAuth, async (req, res) => {
  try {
    const bucket = safeSegment(req.body?.bucket || 'files');
    for (const rel of req.body?.paths || []) {
      const safeRel = String(rel).split('/').map(safeSegment).join('/');
      // Cloud-backed file: read the pointer first, then delete the asset.
      if (cloudinaryEnabled() && pool) {
        const [rows] = await pool.query('SELECT cloud_public_id, cloud_resource_type FROM files_blob WHERE id = ? LIMIT 1', [`${bucket}/${safeRel}`]).catch(() => [[]]);
        if (rows.length && rows[0].cloud_public_id) void cloudinaryDelete(rows[0].cloud_public_id, rows[0].cloud_resource_type || 'raw');
      }
      const target = path.join(UPLOAD_DIR, bucket, safeRel);
      if (target.startsWith(UPLOAD_DIR) && fs.existsSync(target)) fs.unlinkSync(target);
      if (pool) void pool.query('DELETE FROM files_blob WHERE id = ?', [`${bucket}/${safeRel}`]);
      if (r2Enabled()) void r2Delete(`${bucket}/${safeRel}`);
    }
    res.json({ data: null, error: null });
  } catch (err) {
    console.error('[storage] remove failed', err);
    res.status(500).json({ data: null, error: { message: 'Could not remove the file.' } });
  }
});

// Dev-only: create the token so file URLs work immediately.
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });