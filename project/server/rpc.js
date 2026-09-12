import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from './db.js';
import { requireAuth } from './auth.js';

export const rpcRouter = Router();

// POST /api/rpc — mirrors supabase.rpc('set_profile_role', ...) and
// supabase.rpc('delete_user', ...) for the client adapter.
rpcRouter.post('/', requireAuth, async (req, res) => {
  try {
    const { name, args = {} } = req.body || {};
    if (!['set_profile_role', 'delete_user'].includes(name)) {
      return res.status(400).json({ data: null, error: { message: 'Unknown function.' } });
    }

    const [caller] = await pool.query('SELECT role FROM profiles WHERE id = ?', [req.userId]);
    if (!caller.length || caller[0].role !== 'admin') {
      return res.status(403).json({ data: null, error: { message: 'Not authorized' } });
    }

    if (name === 'delete_user') {
      const { p_user_id: userId } = args;
      if (!userId) return res.status(400).json({ data: null, error: { message: 'Invalid user' } });
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
      await pool.query(
        'INSERT INTO audit_logs (id, user_id, action, target_id) VALUES (?, ?, ?, ?)',
        [crypto.randomUUID(), req.userId, 'user_deleted', userId]
      );
      return res.json({ data: { deleted: true }, error: null });
    }

    const { p_profile_id, p_role } = args;
    if (!p_profile_id || !['student', 'teacher', 'admin'].includes(p_role)) {
      return res.status(400).json({ data: null, error: { message: 'Invalid role' } });
    }

    await pool.query('UPDATE profiles SET role = ?, updated_at = NOW() WHERE id = ?', [p_role, p_profile_id]);
    await pool.query(
      'INSERT INTO audit_logs (id, user_id, action, target_id) VALUES (?, ?, ?, ?)',
      [crypto.randomUUID(), req.userId, 'role_updated', p_profile_id]
    );
    res.json({ data: null, error: null });
  } catch (err) {
    console.error('[rpc] failed', err);
    res.status(500).json({ data: null, error: { message: 'Something went wrong. Please try again.' } });
  }
});