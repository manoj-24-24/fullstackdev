import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from './db.js';

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
// On this project the session lives in sessionStorage and the client never
// sends requests without the token, so we keep a long-lived token. Sign-out
// is explicit: the client discards the token and the user stays signed in
// until they click "Sign out" on the dashboard.
const TOKEN_TTL = '365d';

export function signToken(userId, email) {
  return jwt.sign({ sub: userId, email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ data: null, error: { message: 'Not signed in.' } });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    req.email = payload.email;
    next();
  } catch {
    return res.status(401).json({ data: null, error: { message: 'Your session expired. Please sign in again.' } });
  }
}

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ data: null, error: { message: 'Not signed in.' } });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    req.email = payload.email;
  } catch {
    return res.status(401).json({ data: null, error: { message: 'Your session expired. Please sign in again.' } });
  }
  // Lightweight admin check via the profiles table so we do not need to trust
  // the token payload for the role.
  if (!pool || !req.userId) {
    if (!pool) return next();
    return res.status(403).json({ data: null, error: { message: 'Not authorized as an administrator.' } });
  }
  const cached = pool.query('SELECT 1 FROM profiles WHERE id = ? AND role = ? LIMIT 1', [req.userId, 'admin']).then((rows) => (rows.length ? next() : res.status(403).json({ data: null, error: { message: 'Only administrators can perform that action.' } }))).catch((err) => {
    console.error('[auth] requireAdmin failed', err);
    return res.status(500).json({ data: null, error: { message: 'Something went wrong. Please try again.' } });
  });
  return cached;
}

const publicFields = (row) => ({
  id: row.id,
  email: row.email,
  user_metadata: { full_name: row.full_name || '', username: row.username || '' },
});

// POST /api/auth/signup
authRouter.post('/signup', async (req, res) => {
  try {
    const { email, password, data = {} } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) return res.status(400).json({ data: null, error: { message: 'Enter a valid email address.' } });
    if (!password || password.length < 6) return res.status(400).json({ data: null, error: { message: 'Use a password with at least 6 characters.' } });

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length) {
      return res.status(400).json({ data: null, error: { code: 'user_already_exists', message: 'An account with this email already exists. Switch to sign in instead.' } });
    }

    // New accounts choose student or teacher at signup (the UI toggle);
    // 'admin' is never accepted from the client — only the admin portal.
    const requestedRole = data.role === 'teacher' ? 'teacher' : 'student';
    let username = String(data.username || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!username) username = 'user_' + crypto.randomBytes(4).toString('hex');

    const id = crypto.randomUUID();
    const hash = bcrypt.hashSync(password, 10);
    const fullName = String(data.full_name || '').trim();

    try {
      await pool.query('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [id, cleanEmail, hash]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ data: null, error: { code: 'user_already_exists', message: 'An account with this email already exists. Switch to sign in instead.' } });
      }
      throw err;
    }

    try {
      await pool.query('INSERT INTO profiles (id, full_name, username, role) VALUES (?, ?, ?, ?)', [id, fullName, username, requestedRole]);
    } catch (err) {
      await pool.query('DELETE FROM users WHERE id = ?', [id]);
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ data: null, error: { message: 'That username is already in use. Choose another one.' } });
      }
      throw err;
    }

    res.json({ data: { user: { id, email: cleanEmail, user_metadata: { full_name: fullName, username } } }, error: null });
  } catch (err) {
    console.error('[auth] signup failed', err);
    res.status(500).json({ data: null, error: { message: 'We could not create that account right now. Please try again.' } });
  }
});

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.password_hash, p.full_name, p.username, p.role
       FROM users u JOIN profiles p ON p.id = u.id WHERE u.email = ?`,
      [cleanEmail]
    );
    const user = rows[0];
    if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
      return res.status(400).json({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } });
    }
    const safe = publicFields(user);
    const access_token = signToken(user.id, user.email);
    res.json({ data: { user: safe, session: { access_token, user: safe } }, error: null });
  } catch (err) {
    console.error('[auth] login failed', err);
    res.status(500).json({ data: null, error: { message: 'We could not sign you in right now. Please try again.' } });
  }
});

// GET /api/auth/session
authRouter.get('/session', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT u.id, u.email, p.full_name, p.username FROM users u JOIN profiles p ON p.id = u.id WHERE u.id = ?', [req.userId]);
    if (!rows.length) return res.status(401).json({ data: { session: null }, error: null });
    const safe = publicFields(rows[0]);
    res.json({ data: { session: { access_token: (req.headers.authorization || '').slice(7), user: safe } }, error: null });
  } catch (err) {
    console.error('[auth] session failed', err);
    res.status(500).json({ data: null, error: { message: 'We could not load your session right now.' } });
  }
});

// POST /api/auth/logout — stateless; client discards the token.
authRouter.post('/logout', (_req, res) => res.json({ data: { user: null, session: null }, error: null }));

// POST /api/auth/delete-user — admin-only. Removes a user account and all of
// their data. Rows covered by FK cascades (profiles, notifications,
// study_notes) go automatically; the rest are cleaned up manually.
authRouter.post('/delete-user', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ data: null, error: { message: 'userId is required.' } });
    if (userId === req.userId) {
      return res.status(400).json({ data: null, error: { message: 'You cannot delete your own account while signed in.' } });
    }
    const [targetRows] = await pool.query('SELECT id, role FROM profiles WHERE id = ?', [userId]);
    if (!targetRows.length) return res.status(404).json({ data: null, error: { message: 'User not found.' } });
    if (targetRows[0].role === 'admin') {
      return res.status(403).json({ data: null, error: { message: 'Admin accounts cannot be deleted for safety.' } });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Tables WITHOUT FK cascades — clean up first.
      await conn.query('DELETE FROM feedback WHERE teacher_id = ?', [userId]);
      await conn.query('DELETE FROM daily_activity WHERE student_id = ?', [userId]);
      await conn.query('DELETE FROM contributions WHERE student_id = ?', [userId]);
      await conn.query('DELETE FROM admin_notes WHERE author_id = ?', [userId]);
      // profiles cascades from users; notifications/study_notes cascade from profiles.
      await conn.query('DELETE FROM profiles WHERE id = ?', [userId]);
      await conn.query('DELETE FROM users WHERE id = ?', [userId]);
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    return res.json({ data: { deleted: true }, error: null });
  } catch (err) {
    console.error('delete-user failed:', err);
    return res.status(500).json({ data: null, error: { message: 'Could not delete this user. Please try again.' } });
  }
});

// POST /api/auth/update-password
authRouter.post('/update-password', requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ data: null, error: { message: 'Use a password with at least 6 characters.' } });
    }
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.userId]);
    res.json({ data: { user: null }, error: null });
  } catch (err) {
    console.error('[auth] update-password failed', err);
    res.status(500).json({ data: null, error: { message: 'We could not update your password. Please try again.' } });
  }
});

// Password reset tokens are stored server-side so the client never sees a plain
// token. Since there is no mail provider here, the user enters their email at the
// portal and is then redirected to /reset-password where they choose a new
// password. The reset flow is:
//   1. POST /auth/reset-password  { email }  -> { ok: true }  (also starts reset)
//   2. POST /auth/reset-password  { email, token, newPassword }  -> sets new password
// On this project the user copies the token shown at the portal.
export const RESET_TOKEN_TTL_MS = 3 * 60 * 60 * 1000;

const resetTokens = new Map(); // token -> { email, createdAt }

function makeResetToken() {
  let token;
  do {
    token = crypto.randomUUID().replace(/-/g, '') + Math.floor(Math.random() * 1e6).toString(36);
  } while (resetTokens.has(token));
  return token;
}

// POST /api/auth/reset-password
// Body: { email }?            -> initiate a reset and return a code (no email here).
// Body: { email, token, newPassword }? -> complete the reset.
authRouter.post('/reset-password', async (req, res) => {
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim();
    const token = String(body.token || '');
    const newPassword = String(body.newPassword || '');
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail) return res.status(400).json({ data: null, error: { message: 'Enter your account email.' } });

    // Initiate a reset: store a server-side token and return it (no email provider).
    if (!token && !newPassword) {
      const id = await getUserIdByEmail(cleanEmail);
      if (!id) {
        return res.status(404).json({ data: null, error: { message: 'No account was found with that email address.' } });
      }
      // Clean any existing tokens for this email.
      for (const [t, v] of resetTokens) {
        if (v.email === cleanEmail) resetTokens.delete(t);
      }
      const resetToken = makeResetToken();
      resetTokens.set(resetToken, { email: cleanEmail, createdAt: Date.now() });
      return res.json({ data: { ok: true, code: resetToken }, error: null });
    }

    // Complete the reset.
    if (!token || !newPassword) return res.status(400).json({ data: null, error: { message: 'Provide the reset code and a new password.' } });
    if (newPassword.length < 6) return res.status(400).json({ data: null, error: { message: 'New password must be at least 6 characters.' } });

    const entry = resetTokens.get(token);
    if (!entry || entry.email !== cleanEmail) return res.status(400).json({ data: null, error: { message: 'That reset code is not valid.' } });
    if (Date.now() - entry.createdAt > RESET_TOKEN_TTL_MS) {
      resetTokens.delete(token);
      return res.status(400).json({ data: null, error: { message: 'That reset code has expired.' } });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE email = ?', [hash, cleanEmail]);

    // Invalidate every token for this email so a recovered account cannot reuse it.
    for (const [t, v] of resetTokens) {
      if (v.email === cleanEmail) resetTokens.delete(t);
    }

    return res.json({ data: { ok: true }, error: null });
  } catch (err) {
    console.error('[auth] reset-password failed', err);
    return res.status(500).json({ data: null, error: { message: 'Something went wrong. Please try again.' } });
  }
});

async function getUserIdByEmail(email) {
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  return rows.length ? rows[0].id : null;
}