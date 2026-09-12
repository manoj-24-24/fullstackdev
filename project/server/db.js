import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const env = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'fullstackdev',
  // Hosted MySQL providers (Aiven, Railway, PlanetScale, etc.) require TLS;
  // local MySQL does not, so this stays opt-in via env.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
};

/** @type {import('mysql2/promise').Pool | null} */
export let pool = null;

/**
 * Connects to MySQL, creates the database if missing, applies the schema,
 * and seeds the default admin account + subjects.
 */
export async function initDb() {
  const safeDb = env.database.replace(/[^A-Za-z0-9_]/g, '');
  // Local MySQL lets the app create its own database; hosted providers usually
  // pre-create it with a fixed name and deny CREATE DATABASE, so tolerate that.
  if (process.env.DB_CREATE !== 'false') {
    try {
      const bootstrap = await mysql.createConnection({
        host: env.host,
        port: env.port,
        user: env.user,
        password: env.password,
        ssl: env.ssl,
        multipleStatements: true,
      });
      await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${safeDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await bootstrap.end();
    } catch (err) {
      if (err?.code !== 'ER_DBACCESS_DENIED_ERROR' && err?.errno !== 1044 && err?.errno !== 1045) throw err;
      console.log('[db] CREATE DATABASE not permitted — assuming the database is pre-created by the host.');
    }
  }

  pool = mysql.createPool({
    host: env.host,
    port: env.port,
    user: env.user,
    password: env.password,
    database: safeDb,
    waitForConnections: true,
    connectionLimit: 10,
    multipleStatements: true,
    dateStrings: true,
    decimalNumbers: true,
    ssl: env.ssl,
  });

  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  await applyMigrations();
  await seed();
  return pool;
}

/**
 * Column-level migrations for tables that already exist (CREATE TABLE IF NOT
 * EXISTS cannot add columns to them). Idempotent: 1060 = duplicate column.
 */
async function applyMigrations() {
  const migrations = [
    // Cloud-storage pointer columns for files_blob (data NULL = bytes in cloud).
    'ALTER TABLE files_blob MODIFY COLUMN data LONGBLOB NULL',
    'ALTER TABLE files_blob ADD COLUMN cloud_public_id VARCHAR(500) NULL',
    'ALTER TABLE files_blob ADD COLUMN cloud_resource_type VARCHAR(20) NULL',
  ];
  for (const migration of migrations) {
    try {
      await pool.query(migration);
    } catch (err) {
      if (err?.errno !== 1060) throw err;
    }
  }
}

async function seed() {
  // Default administrator account.
  const adminEmail = 'moogle.2416@gmail.com';
  const adminHash = bcrypt.hashSync('Man$vi@code*924', 10);
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (!existing.length) {
    const id = crypto.randomUUID();
    // Avoid clashing with any existing 'admin' username (unique key), like the
    // old Postgres new-user trigger's fallback behavior.
    const [nameTaken] = await pool.query('SELECT id FROM profiles WHERE username = ?', ['admin']);
    const username = nameTaken.length ? `admin_${id.slice(0, 8)}` : 'admin';
    await pool.query('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [id, adminEmail, adminHash]);
    await pool.query(
      'INSERT INTO profiles (id, full_name, username, role) VALUES (?, ?, ?, ?)',
      [id, 'Platform Administrator', username, 'admin']
    );
    console.log('[db] Seeded default administrator: moogle.2416@gmail.com');
  } else {
    // Local dev convenience: the default admin must always be able to sign in —
    // re-assert the role (e.g. after experiments with the role dropdown) and
    // reset the password to the documented default so the account can never be
    // locked out. NEVER active in production (NODE_ENV=production): there the
    // password you set stays, exactly as a real deployment should behave.
    await pool.query(
      "UPDATE profiles p JOIN users u ON u.id = p.id SET p.role = 'admin' WHERE u.email = ?",
      [adminEmail]
    );
    if (process.env.NODE_ENV !== 'production') {
      await pool.query('UPDATE users SET password_hash = ? WHERE email = ?', [adminHash, adminEmail]);
      console.log('[db] Default administrator ensured: role=admin, password reset to default');
    } else {
      console.log('[db] Default administrator ensured: role=admin (production: password left untouched)');
    }
  }

  // Learning subjects.
  const subjects = ['Frontend', 'Backend', 'Cloud Computing'];
  for (const name of subjects) {
    await pool.query('INSERT IGNORE INTO subjects (id, name) VALUES (?, ?)', [crypto.randomUUID(), name]);
  }
}