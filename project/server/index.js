import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import { authRouter } from './auth.js';
import { queryRouter } from './query.js';
import { rpcRouter } from './rpc.js';
import { storageRouter, UPLOAD_DIR, serveUpload } from './storage.js';
import { initCloudinary } from './cloudinary.js';
import { requireAdmin } from './auth.js';
import migrateRouter from './migrate-route.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3001;
// Built frontend (npm run build). When present — e.g. on Render, where one
// service serves both the app and the API — static hosting takes over.
const DIST_DIR = path.join(__dirname, '..', 'dist');
const hasDist = fs.existsSync(path.join(DIST_DIR, 'index.html'));

initCloudinary();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// PWA identity files must always be revalidated, or installed apps keep a
// stale app icon / service worker after a redeploy.
app.use((req, res, next) => {
  if (/^\/(api\/)?(manifest\.webmanifest|sw\.js|icon-.*\.png|apple-touch-icon\.png|favicon\.png)(\?|$)/.test(req.url || '')) {
    res.setHeader('Cache-Control', 'no-cache');
  }
  next();
});

// File storage served statically, with database fallback for files that
// only exist in the DB (fresh deploy) — replaces Supabase Storage.
app.use('/uploads', express.static(UPLOAD_DIR));
app.get(/^\/uploads\/.+/, serveUpload);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'fullstackdev-mysql' }));

if (hasDist) {
  // Single-service deployment: serve the built app, then fall back to
  // index.html for client-side routes like /teacher or /notifications.
  app.use(express.static(DIST_DIR));
  app.get(/^\/(?!api\/|uploads\/?).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  // Friendly landing page so visiting http://localhost:3001 directly isn't confusing.
  app.get('/', (_req, res) => {
    res.type('html').send(
      '<html><head><meta charset="utf-8"><title>FullstackDev API</title></head><body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">' +
      '<h1>✅ FullstackDev MySQL API is running</h1>' +
      '<p>This is the <b>backend API</b> — the web app is not here.</p>' +
      '<p>Open the app at <a href="http://localhost:5173">http://localhost:5173</a></p>' +
      '</body></html>'
    );
  });
}

app.use('/api/auth', authRouter);
app.use('/api/query', queryRouter);
app.use('/api/rpc', rpcRouter);
app.use('/api/storage', storageRouter);
// TEMPORARY admin-only migration trigger (blob bytes -> cloud storage).
// Removed in the next commit once the one-time migration has run.
app.use('/api/admin/migrate-blobs', requireAdmin, migrateRouter);

app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error', err);
  res.status(500).json({ data: null, error: { message: 'Something went wrong. Please try again.' } });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] FullstackDev MySQL API running on http://localhost:${PORT}${hasDist ? ' (serving the built app)' : ''}`);
    });
  })
  .catch((err) => {
    console.error('[server] Failed to connect to MySQL:', err.message);
    console.error('[server] Check DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME in project/.env');
    process.exit(1);
  });

// Never crash the whole API because port 3001 happens to be busy.
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${PORT} is already in use — the API is probably already running. Visiting http://localhost:${PORT} will confirm.`);
  } else {
    console.error('[server] Uncaught exception:', err);
    process.exit(1);
  }
});