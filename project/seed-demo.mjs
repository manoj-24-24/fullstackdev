// One-off: recreate the demo accounts the guard suite (and manual testing) relies on.
// Run: node seed-demo.mjs   (idempotent — safe to run twice)
import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const accounts = [
  { email: 'demostudent@app.local', password: 'Student@123', name: 'Demo Student', username: 'demostudent', role: 'student' },
  { email: 'teacher.demo@app.local', password: 'Teach@1234', name: 'Demo Teacher', username: 'demoteacher', role: 'teacher' },
  { email: 'leo@app.local', password: 'Leo@12345', name: 'leo', username: 'leo', role: 'student' },
];

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: (process.env.DB_NAME || 'fullstackdev').replace(/[^A-Za-z0-9_]/g, ''),
});

for (const a of accounts) {
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [a.email]);
  if (existing.length) {
    await pool.query('UPDATE users SET password_hash = ? WHERE email = ?', [bcrypt.hashSync(a.password, 10), a.email]);
    console.log(`updated ${a.email}`);
  } else {
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [id, a.email, bcrypt.hashSync(a.password, 10)]);
    await pool.query('INSERT INTO profiles (id, full_name, username, role) VALUES (?, ?, ?, ?)', [id, a.name, a.username, a.role]);
    console.log(`created ${a.email} (${a.role})`);
  }
}
await pool.end();
console.log('demo accounts ready');
