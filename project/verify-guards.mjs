const BASE = 'http://localhost:3001/api';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${extra}`); } };
const eq = (col, value) => [{ column: col, operator: 'eq', value }];
async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}
const login = (email, password) => req('/auth/login', { method: 'POST', body: { email, password } });

const admin = await login('moogle.2416@gmail.com', 'Man$vi@code*924');
const adminToken = admin.data.session.access_token;
const adminId = admin.data.user.id;
const stu = await login('demostudent@app.local', 'Student@123');
const stuToken = stu.data.session.access_token;
const stuId = stu.data.user.id;
const tea = await login('teacher.demo@app.local', 'Teach@1234');
const teaToken = tea.data.session.access_token;
const teaId = tea.data.user.id;
ok('all three roles log in', !!adminToken && !!stuToken && !!teaToken);

// Seed one pending contribution owned by the student (unique title; select THAT row).
const seedTitle = `GuardProbe${Date.now()}`;
const subj = (await req('/query', { method: 'POST', token: stuToken, body: { op: 'select', table: 'subjects', limit: 1 } })).data[0].id;
await req('/query', { method: 'POST', token: stuToken, body: { op: 'insert', table: 'contributions', data: { title: seedTitle, summary: 's', description: 'd', subject_id: subj, category: 'Frontend', contribution_date: new Date().toISOString().slice(0, 10) } } });
const contrib = (await req('/query', { method: 'POST', token: stuToken, body: { op: 'select', table: 'contributions', filters: eq('title', seedTitle) } })).data[0];
const contribId = contrib.id;

console.log('ATTACK 1: student self-approves own contribution');
const a1 = await req('/query', { method: 'POST', token: stuToken, body: { op: 'update', table: 'contributions', data: { status: 'approved', score: 100 }, filters: eq('id', contribId) } });
ok('self-approve rejected', !!a1.error && /teachers and administrators/i.test(a1.error.message || ''), JSON.stringify(a1));

console.log('ATTACK 2: student sneaks status through a mixed payload');
const a2 = await req('/query', { method: 'POST', token: stuToken, body: { op: 'update', table: 'contributions', data: { status: 'approved', summary: 'innocent edit' }, filters: eq('id', contribId) } });
const after2 = (await req('/query', { method: 'POST', token: stuToken, body: { op: 'select', table: 'contributions', filters: eq('id', contribId) } })).data[0];
ok('mixed payload: status stripped, own field applied', !a2.error && after2.status === 'pending' && after2.summary === 'innocent edit', JSON.stringify({ a2, status: after2.status }));

console.log('ATTACK 3: student edits another user profile');
const leo = (await req('/query', { method: 'POST', token: adminToken, body: { op: 'select', table: 'profiles', filters: eq('username', 'leo') } })).data[0];
const a3 = await req('/query', { method: 'POST', token: stuToken, body: { op: 'update', table: 'profiles', data: { full_name: 'HACKED' }, filters: eq('id', leo.id) } });
const leoAfter = (await req('/query', { method: 'POST', token: adminToken, body: { op: 'select', table: 'profiles', filters: eq('id', leo.id) } })).data[0];
ok('cross-profile edit rejected', !!a3.error && leoAfter.full_name === 'leo', JSON.stringify({ err: a3.error, name: leoAfter.full_name }));

console.log('ATTACK 4: student escalates own profile role');
const a4 = await req('/query', { method: 'POST', token: stuToken, body: { op: 'update', table: 'profiles', data: { role: 'admin' }, filters: eq('id', stuId) } });
const meAfter = (await req('/query', { method: 'POST', token: adminToken, body: { op: 'select', table: 'profiles', filters: eq('id', stuId) } })).data[0];
ok('role escalation rejected', !!a4.error && meAfter.role === 'student', JSON.stringify({ err: a4.error, role: meAfter.role }));

console.log('ATTACK 5: student deletes/updates by guessing another id');
const leoC = (await req('/query', { method: 'POST', token: adminToken, body: { op: 'select', table: 'contributions', filters: eq('student_id', leo.id) } })).data[0];
if (leoC) {
  const a5 = await req('/query', { method: 'POST', token: stuToken, body: { op: 'update', table: 'contributions', data: { title: 'stolen' }, filters: eq('id', leoC.id) } });
  ok('cross-user contribution update 404s', !!a5.error, JSON.stringify(a5));
} else ok('cross-user contribution update 404s (no target, skip)', true);

console.log('LEGIT 1: student edits own pending contribution');
const l1 = await req('/query', { method: 'POST', token: stuToken, body: { op: 'update', table: 'contributions', data: { summary: 'my own edit' }, filters: eq('id', contribId) } });
ok('own edit works', !l1.error, JSON.stringify(l1));

console.log('LEGIT 2: teacher reviews (approve + score)');
const l2 = await req('/query', { method: 'POST', token: teaToken, body: { op: 'update', table: 'contributions', data: { status: 'approved', score: 85 }, filters: eq('id', contribId) } });
const afterL2 = (await req('/query', { method: 'POST', token: teaToken, body: { op: 'select', table: 'contributions', filters: eq('id', contribId) } })).data[0];
ok('teacher review works', !l2.error && afterL2.status === 'approved' && Number(afterL2.score) === 85, JSON.stringify({ err: l2.error, s: afterL2.status, sc: afterL2.score }));

console.log('LEGIT 3: admin approves');
await req('/query', { method: 'POST', token: teaToken, body: { op: 'update', table: 'contributions', data: { status: 'pending', score: null }, filters: eq('id', contribId) } });
const l3 = await req('/query', { method: 'POST', token: adminToken, body: { op: 'update', table: 'contributions', data: { status: 'approved', score: 90 }, filters: eq('id', contribId) } });
ok('admin approve works', !l3.error, JSON.stringify(l3));

console.log('LEGIT 4: admin edits any profile (role change path intact via rpc)');
const l4 = await req('/query', { method: 'POST', token: adminToken, body: { op: 'update', table: 'profiles', data: { bio: 'audit probe' }, filters: eq('id', leo.id) } });
ok('admin can edit other profiles', !l4.error, JSON.stringify(l4));
await req('/query', { method: 'POST', token: adminToken, body: { op: 'update', table: 'profiles', data: { bio: null }, filters: eq('id', leo.id) } });

console.log('LEGIT 5: 404 not silent success on zero rows');
const l5 = await req('/query', { method: 'POST', token: stuToken, body: { op: 'update', table: 'contributions', data: { summary: 'x' }, filters: eq('id', '00000000-0000-0000-0000-000000000000') } });
ok('zero-row update returns 404-style error', !!l5.error, JSON.stringify(l5));

console.log('REGRESSION: admin queue edit + feedback + note flows');
const l6 = await req('/query', { method: 'POST', token: adminToken, body: { op: 'insert', table: 'feedback', data: { contribution_id: contribId, teacher_id: teaId, reviewer_name: 'Demo Teacher', feedback: 'probe feedback', score: 85, status: 'approved' } } });
ok('feedback insert still works', !l6.error, JSON.stringify(l6.error || ''));
const noteTitle = `ProbeNote${Date.now()}`;
const l7 = await req('/query', { method: 'POST', token: adminToken, body: { op: 'insert', table: 'admin_notes', data: { title: noteTitle, summary: 'x' } } });
ok('admin note insert still works', !l7.error, JSON.stringify(l7.error || ''));
const noteId = (await req('/query', { method: 'POST', token: adminToken, body: { op: 'select', table: 'admin_notes', filters: eq('title', noteTitle) } })).data[0]?.id;
ok('inserted note is selectable (single-eval title)', !!noteId);
const l8 = await req('/query', { method: 'POST', token: adminToken, body: { op: 'delete', table: 'admin_notes', filters: noteId ? eq('id', noteId) : eq('title', noteTitle) } });
ok('admin note delete still works', !l8.error, JSON.stringify(l8.error || ''));
const fbId = (await req('/query', { method: 'POST', token: adminToken, body: { op: 'select', table: 'feedback', filters: eq('contribution_id', contribId) } })).data[0]?.id;
const l9 = await req('/query', { method: 'POST', token: adminToken, body: { op: 'delete', table: 'feedback', filters: eq('id', fbId) } });
ok('admin feedback delete still works', !l9.error, JSON.stringify(l9.error || ''));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
