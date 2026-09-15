import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from './db.js';
import { requireAuth } from './auth.js';
import { deliver } from './push.js';

export const queryRouter = Router();

// Tables the app can query, plus join relations used via `select('*, rel(*)')`.
const TABLES = {
  profiles: ['id', 'full_name', 'username', 'avatar', 'bio', 'github_url', 'linkedin_url', 'role', 'created_at', 'updated_at'],
  subjects: ['id', 'name', 'created_at'],
  contributions: ['id', 'student_id', 'subject_id', 'title', 'summary', 'description', 'code', 'github_url', 'contribution_date', 'status', 'score', 'created_at', 'updated_at'],
  contribution_files: ['id', 'contribution_id', 'file_url', 'file_name', 'file_type', 'created_at'],
  feedback: ['id', 'contribution_id', 'teacher_id', 'reviewer_name', 'reviewer_role', 'feedback', 'score', 'status', 'created_at'],
  daily_activity: ['id', 'student_id', 'activity_date', 'contribution_count', 'daily_score'],
  notifications: ['id', 'user_id', 'sender_id', 'sender_name', 'sender_role', 'title', 'message', 'type', 'read', 'created_at'],
  study_notes: ['id', 'user_id', 'category', 'title', 'description', 'file_path', 'file_name', 'file_type', 'created_at'],
  scoring_rules: ['id', 'name', 'description', 'points', 'created_at'],
  audit_logs: ['id', 'user_id', 'action', 'target_id', 'created_at'],
  admin_notes: ['id', 'author_id', 'subject_id', 'title', 'summary', 'description', 'code', 'file_path', 'file_name', 'file_type', 'created_at', 'updated_at'],
  note_feedback: ['id', 'note_id', 'user_id', 'reviewer_name', 'role', 'feedback', 'created_at'],
  syllabus: ['id', 'subject_id', 'title', 'file_path', 'file_name', 'file_type', 'uploaded_by', 'created_at', 'updated_at'],
};

// How joined relations map back to their foreign-key column on the base table.
const JOINS = {
  contributions: { subjects: 'subject_id', profiles: 'student_id' },
  feedback: { profiles: 'teacher_id' },
  admin_notes: { subjects: 'subject_id', profiles: 'author_id' },
  study_notes: { profiles: 'user_id' },
  syllabus: { subjects: 'subject_id', profiles: 'uploaded_by' },
};

const q = (name) => `\`${name.replace(/[^a-zA-Z0-9_]/g, '')}\``;

function parseSelect(select, table) {
  const joins = [];
  if (typeof select === 'string') {
    // Split on TOP-LEVEL commas only: commas inside `rel(col1, col2)` are
    // column separators, not relation boundaries.
    const normalized = select.replace(/\([^)]*\)/g, (m) => m.replace(/,/g, ';'));
    for (const part of normalized.split(',')) {
      const cleaned = part.trim().replace(/;/g, ',');
      const match = cleaned.match(/^(\w+)\(([^)]*)\)$/); // `rel(*)` and `rel(col1, col2)` both join; returned columns are whitelisted
      if (match && JOINS[table]?.[match[1]] && TABLES[match[1]]) joins.push({ rel: match[1], fk: JOINS[table][match[1]] });
    }
  }
  return joins;
}

// Builds WHERE clauses. When `qualified` is true (SELECTs with joins), columns
// are prefixed with the base-table alias `b` so names like `id` aren't ambiguous
// against joined tables that also have an `id` column.
function buildWhere(filters, allowed, qualified = false) {
  const clauses = [];
  const params = [];
  const prefix = qualified ? 'b.' : '';
  for (const filter of filters || []) {
    if (!allowed.includes(filter.column)) continue;
    if (filter.operator === 'in') {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      if (!values.length) {
        clauses.push('1 = 0');
        continue;
      }
      clauses.push(`${prefix}${q(filter.column)} IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    } else if (filter.value !== undefined && filter.value !== null) {
      const opSql = filter.operator === 'neq' ? '<>' : '=';
      clauses.push(`${prefix}${q(filter.column)} ${opSql} ?`);
      params.push(filter.value);
    }
  }
  return { clauses, params };
}

function buildOrder(order, allowed) {
  const parts = [];
  for (const item of order || []) {
    if (!allowed.includes(item.column)) continue;
    parts.push(`${q(item.column)} ${item.ascending === false ? 'DESC' : 'ASC'}`);
  }
  return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
}

async function selectRows(table, select, filters, order, limit) {
  const cols = TABLES[table];
  const joins = parseSelect(select, table);
  const where = buildWhere(filters, cols, joins.length > 0);
  const params = [...where.params];

  let sql = `SELECT b.*`;
  const joinParts = [];
  for (const j of joins) {
    const jCols = TABLES[j.rel];
    sql += `, ${jCols.map((c) => `j${j.rel}.\`${c}\` AS \`${j.rel}__${c}\``).join(', ')}`;
    joinParts.push(`LEFT JOIN ${q(j.rel)} j${j.rel} ON j${j.rel}.id = b.${q(j.fk)}`);
  }
  sql += ` FROM ${q(table)} b`;
  if (joinParts.length) sql += ` ${joinParts.join(' ')}`;
  if (where.clauses.length) sql += ` WHERE ${where.clauses.join(' AND ')}`;
  const orderSql = buildOrder(order, cols);
  if (orderSql) sql += ` ${orderSql}`;
  if (limit) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }

  const [rows] = await pool.query(sql, params);
  return rows.map((row) => {
    const out = { ...row };
    for (const j of joins) {
      const nested = {};
      let has = false;
      for (const c of TABLES[j.rel]) {
        const key = `${j.rel}__${c}`;
        if (key in out) {
          nested[c] = out[key];
          delete out[key];
          has = true;
        }
      }
      out[j.rel] = has ? nested : null;
    }
    return out;
  });
}

// POST /api/query
// body: { op, table, select, filters, order, limit, data, onConflict, single }
queryRouter.post('/', requireAuth, async (req, res) => {
  try {
    const { op = 'select', table, select = '*', order, limit, onConflict, single } = req.body || {};
    let filters = (req.body || {}).filters;
    let data = (req.body || {}).data;
    if (!TABLES[table]) return res.status(400).json({ data: null, error: { message: 'Unknown table.' } });
    const cols = TABLES[table];

    // Server-controlled ownership columns, mirroring the old auth.uid() defaults.
    const owned = { contributions: 'student_id', feedback: 'teacher_id', study_notes: 'user_id', notifications: 'user_id', admin_notes: 'author_id', note_feedback: 'user_id', syllabus: 'uploaded_by' };

    if (op === 'select') {
      // Notifications are private to their recipient — scope every read to the
      // caller regardless of what filters the client sends.
      const scopedFilters = table === 'notifications'
        ? [...(filters || []), { column: 'user_id', value: req.userId }]
        : filters;
      const rows = await selectRows(table, select, scopedFilters, order, limit);
      return res.json({ data: single ? rows[0] ?? null : rows, error: null });
    }

    // Caller role, resolved once for the update/delete policy below.
    const [meRows] = await pool.query('SELECT role, full_name, username FROM profiles WHERE id = ?', [req.userId]);
    const role = meRows.length ? meRows[0].role : 'student';
    const profileName = meRows.length ? (meRows[0].full_name || meRows[0].username || 'Member') : 'Member';
    const isAdmin = role === 'admin';
    const isStaff = isAdmin || role === 'teacher';

    // Anyone may send a notification to any other user (admin -> teacher ->
    // student and back). The server stamps the true sender identity so the
    // receiver always sees who it came from; clients cannot forge it.
    if ((op === 'insert' || op === 'upsert') && table === 'notifications') {
      const payload = { ...(data || {}) };
      payload.user_id = String(payload.user_id || '');
      if (!payload.user_id) return res.status(400).json({ data: null, error: { message: 'Choose who should receive this notification.' } });
      if (payload.user_id !== req.userId) {
        const [target] = await pool.query('SELECT id FROM profiles WHERE id = ?', [payload.user_id]);
        if (!target.length) return res.status(400).json({ data: null, error: { message: 'That recipient does not exist.' } });
      }
      const [me] = await pool.query('SELECT full_name, username FROM profiles WHERE id = ?', [req.userId]);
      payload.sender_id = req.userId;
      payload.sender_name = profileName;
      payload.sender_role = role;
      data = payload;
    }

    if (op === 'delete') {
      const where = buildWhere(filters, cols);
      if (!where.clauses.length) return res.status(400).json({ data: null, error: { message: 'Delete requires a filter.' } });
      // Admins may delete anything (e.g. spammy review comments); everyone else
      // may only delete rows they own, enforced here on the server.
      if (!isAdmin) {
        const ownerCol = owned[table];
        if (!ownerCol) return res.status(403).json({ data: null, error: { message: 'Only administrators can delete that.' } });
        where.clauses.push(`${q(ownerCol)} = ?`);
        where.params.push(req.userId);
      }
      // Child rows are captured BEFORE the delete and cleaned up after:
      // databases created before FK cascades were added to schema.sql have no
      // ON DELETE CASCADE on contribution_files / feedback.
      let contributionIds = [];
      if (table === 'contributions') {
        const [rows_] = await pool.query(`SELECT id FROM ${q(table)} WHERE ${where.clauses.join(' AND ')}`, where.params).catch(() => [[]]);
        contributionIds = (rows_ || []).map((r) => r.id);
      }
      const [result] = await pool.query(`DELETE FROM ${q(table)} WHERE ${where.clauses.join(' AND ')}`, where.params);
      if (table === 'contributions' && result.affectedRows && contributionIds.length) {
        const ph = contributionIds.map(() => '?').join(', ');
        const [files] = await pool.query(`SELECT file_url FROM contribution_files WHERE contribution_id IN (${ph})`, contributionIds).catch(() => [[]]);
        await pool.query(`DELETE FROM contribution_files WHERE contribution_id IN (${ph})`, contributionIds);
        await pool.query(`DELETE FROM feedback WHERE contribution_id IN (${ph})`, contributionIds);
        for (const f of files || []) {
          const p = String(f.file_url || '');
          if (p) void pool.query('DELETE FROM files_blob WHERE id = ?', [`contribution-files/${p}`]);
        }
      }
      if (!result.affectedRows) {
        return res.status(404).json({ data: null, error: { message: 'That record was not found, or you do not have access to it.' } });
      }
      return res.json({ data: null, error: null });
    }

    if (op === 'insert' || op === 'upsert') {
      const payload = { ...(data || {}) };
      // Server-controlled columns: never let a client set these through the generic endpoint.
      if (table === 'profiles') delete payload.role;
      // Identity is stamped server-side: the owner column is always the
      // authenticated caller, and reviewer names/roles come from their profile —
      // never from the payload (mirrors the notification sender stamping).
      // notifications.user_id is the RECIPIENT (validated/stamped by the
      // special-case above), not the sender — skip generic owner stamping.
      if (owned[table] && table !== 'notifications') payload[owned[table]] = req.userId;
      if (table === 'feedback') {
        // Contribution reviews are written by teachers and admins only; students
        // comment on notes via note_feedback instead.
        if (!isStaff) return res.status(403).json({ data: null, error: { message: 'Only teachers and administrators can review contributions.' } });
        payload.reviewer_name = profileName;
        payload.reviewer_role = role;
      }
      if (table === 'note_feedback') payload.role = role;
      if (table === 'syllabus') {
        // Syllabus files are curated by teachers/admins; the uploader is always
        // the caller, and one row per subject is enforced via upsert.
        if (!isStaff) return res.status(403).json({ data: null, error: { message: 'Only teachers and administrators can upload the syllabus.' } });
        payload.uploaded_by = req.userId;
      }
      if (table === 'contributions') {
        // Student work enters the approval queue; teacher/admin contributions
        // are published immediately so students and admins can see them.
        if (!isStaff) { payload.status = 'pending'; payload.score = null; }
        else payload.status = 'approved';
      }
      if (!payload.id) payload.id = crypto.randomUUID();
      const insertCols = Object.keys(payload).filter((c) => cols.includes(c));
      if (!insertCols.length) return res.status(400).json({ data: null, error: { message: 'No valid fields to save.' } });

      let sql = `INSERT INTO ${q(table)} (${insertCols.map(q).join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`;
      const params = insertCols.map((c) => payload[c]);

      if (op === 'upsert') {
        const conflictCols = (onConflict || 'id').split(',').map((s) => s.trim()).filter((c) => cols.includes(c));
        if (conflictCols.length) {
          // Never rewrite the primary key or server-managed timestamps on conflict.
          const updCols = insertCols.filter((c) => !conflictCols.includes(c) && !['id', 'created_at', 'updated_at'].includes(c));
          if (updCols.length) {
            sql += ` ON DUPLICATE KEY UPDATE ${updCols.map((c) => `${q(c)} = VALUES(${q(c)})`).join(', ')}`;
          }
        }
      }
      await pool.query(sql, params);

      // Real-time delivery: fan this notification out as an OS-level web push
      // (fire-and-forget — a push failure never fails the write).
      if (table === 'notifications') {
        void deliver({ user_id: payload.user_id, title: payload.title, message: payload.message });
      }

      if (single) {
        const keyFilters = (onConflict || 'id').split(',').map((s) => s.trim()).filter((c) => cols.includes(c) && payload[c] !== undefined).map((c) => ({ column: c, operator: 'eq', value: payload[c] }));
        const rows = await selectRows(table, select, keyFilters.length ? keyFilters : [{ column: 'id', operator: 'eq', value: payload.id }], [], 1);
        return res.json({ data: rows[0] ?? null, error: null });
      }
      return res.json({ data: null, error: null });
    }

    if (op === 'update') {
      const payload = { ...(data || {}) };
      // Immutable / server-controlled columns are never writable through this endpoint.
      const neverUpdate = ['id', 'created_at', 'updated_at'];
      // Review fields on contributions: teachers and admins only, never students.
      const staffOnlyFields = table === 'contributions' ? ['status', 'score'] : [];
      let updCols = Object.keys(payload).filter((c) => cols.includes(c) && !neverUpdate.includes(c) && !(table === 'profiles' && c === 'role'));
      // When set, this column is AND-ed onto the WHERE clause so non-admins can
      // never reach another user's row, even with a forged id filter.
      let ownerCol = null;

      if (!isAdmin) {
        if (table === 'profiles' && payload.role !== undefined) {
          return res.status(403).json({ data: null, error: { message: 'Only administrators can change roles.' } });
        }
        const staffAttempt = updCols.filter((c) => staffOnlyFields.includes(c));
        if (staffAttempt.length && !isStaff) {
          updCols = updCols.filter((c) => !staffAttempt.includes(c));
          if (!updCols.length) {
            return res.status(403).json({ data: null, error: { message: 'Only teachers and administrators can change review status or score.' } });
          }
        }
        // Ownership: profiles are editable only on your own row; owned tables are
        // owner-scoped (except staff touching review fields); anything else is
        // administrator-only. staffFields holds the staff-allowed review fields.
        const staffFields = updCols.filter((c) => staffOnlyFields.includes(c));
        const ownFields = updCols.filter((c) => !staffOnlyFields.includes(c));
        if (table === 'profiles') {
          ownerCol = 'id';
        } else if (owned[table]) {
          if (ownFields.length || !isStaff) ownerCol = owned[table];
        } else {
          return res.status(403).json({ data: null, error: { message: 'Only administrators can modify that.' } });
        }
        updCols = [...ownFields, ...staffFields];
      }

      if (!updCols.length) return res.status(400).json({ data: null, error: { message: 'No valid fields to update.' } });
      const where = buildWhere(filters, cols);
      // Ownership is AND-ed on top of the caller's filters, so a forged id still
      // cannot reach another user's row (zero affected rows -> 404 below).
      if (ownerCol) {
        where.clauses.push(`${q(ownerCol)} = ?`);
        where.params.push(req.userId);
      }
      if (!where.clauses.length) return res.status(400).json({ data: null, error: { message: 'Update requires a filter.' } });
      const params = [...updCols.map((c) => payload[c]), ...where.params];
      const [result] = await pool.query(`UPDATE ${q(table)} SET ${updCols.map((c) => `${q(c)} = ?`).join(', ')} WHERE ${where.clauses.join(' AND ')}`, params);
      if (!result.affectedRows) {
        return res.status(404).json({ data: null, error: { message: 'That record was not found, or you do not have access to it.' } });
      }
      if (single) {
        const rows = await selectRows(table, select, filters, [], 1);
        return res.json({ data: rows[0] ?? null, error: null });
      }
      return res.json({ data: null, error: null });
    }

    res.status(400).json({ data: null, error: { message: 'Unknown operation.' } });
  } catch (err) {
    console.error('[query] failed', err);
    res.status(500).json({ data: null, error: { message: 'Something went wrong. Please try again.' } });
  }
});