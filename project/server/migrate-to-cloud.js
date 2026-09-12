// One-time migration: copy legacy file bytes from the MySQL files_blob table
// into the configured cloud storage (Cloudinary first, then R2), then shrink
// each row to a metadata/pointer row with data = NULL. Run whenever the
// storage env vars are set and the database still holds bytes:
//   node server/migrate-to-cloud.js
// Safe to re-run: rows without bytes are skipped.
import 'dotenv/config';
import { initDb, pool } from './db.js';
import { initCloudinary, cloudinaryEnabled, cloudinaryPut } from './cloudinary.js';
import { r2Enabled, r2Put } from './r2.js';

initCloudinary();
if (!cloudinaryEnabled() && !r2Enabled()) {
  console.error('No cloud storage configured. Set CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET (or the R2_* vars) first.');
  process.exit(1);
}

await initDb();

const [rows] = await pool.query('SELECT id, bucket, path, mime, size, data FROM files_blob WHERE data IS NOT NULL');
console.log(`[migrate] ${rows.length} file(s) to move`);

let ok = 0;
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
    ok += 1;
    console.log(`[migrate] moved ${key} (${row.size} bytes)`);
  } catch (err) {
    console.error(`[migrate] FAILED ${key} — bytes kept in MySQL`, err.message || err);
  }
}

console.log(`[migrate] done: ${ok}/${rows.length} moved. Files that failed stay safe in the database.`);
process.exit(0);
