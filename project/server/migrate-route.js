// TEMPORARY migration trigger — exists only because Render's free plan has no
// shell and the operator's home network blocks Aiven's 3306. Admin-only.
// Runs the same copy loop as server/migrate-to-cloud.js inside the API process:
// copies file bytes from MySQL files_blob to the configured cloud storage
// (Cloudinary first, then B2/R2), then NULLs the bytes row by row.
// Removed in the next commit once the migration has run.
import { pool } from './db.js';
import { cloudinaryEnabled, cloudinaryPut } from './cloudinary.js';
import { objectStoreEnabled, r2Put } from './r2.js';

import { Router } from 'express';
const router = Router();

let running = false;
let lastResult = null;

router.post('/', async (req, res) => {
  if (running) return res.status(409).json({ data: { status: lastResult, message: 'already running' }, error: null });
  if (!cloudinaryEnabled() && !objectStoreEnabled()) {
    return res.status(400).json({ data: null, error: { message: 'No cloud storage configured on this deployment.' } });
  }
  const [rows] = await pool.query('SELECT id, bucket, path, mime, size, data FROM files_blob WHERE data IS NOT NULL');
  running = true;
  lastResult = { total: rows.length, moved: 0, failed: 0, failures: [] };
  res.json({ data: { started: true, total: rows.length }, error: null });
  // Fire-and-report: the HTTP response is already sent; failures are recorded.
  void (async () => {
    for (const row of rows) {
      const key = `${row.bucket}/${row.path}`;
      try {
        if (cloudinaryEnabled()) {
          const { publicId, resourceType } = await cloudinaryPut(key, row.data, row.mime);
          await pool.query('UPDATE files_blob SET data = NULL, cloud_public_id = ?, cloud_resource_type = ? WHERE id = ?', [publicId, resourceType, row.id]);
        } else {
          await r2Put(key, row.data, row.mime);
          await pool.query('UPDATE files_blob SET data = NULL WHERE id = ?', [row.id]);
        }
        lastResult.moved += 1;
      } catch (err) {
        lastResult.failed += 1;
        lastResult.failures.push({ key, message: String(err?.message || err).slice(0, 140) });
      }
    }
    running = false;
    lastResult.done = true;
  })();
});

router.get('/', (_req, res) => {
  res.json({ data: { running, ...lastResult }, error: null });
});

export default router;
