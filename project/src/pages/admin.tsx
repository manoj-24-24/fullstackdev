import { useState, useEffect, FormEvent } from 'react';
import { formatDate, friendlyError, isUploadAllowed, useLiveRefresh, UPLOAD_ACCEPT, uploadTypeHint } from '@/lib/ui';
import { Avatar, EmptyState, LoadingPanel, NotFound, PageHeader, RoleBadge, StatCard, StatusPill } from '@/components/shared';
import { CodeBlock } from '@/components/viewer';
import { NoteFileLink } from '@/components/viewer';
import { ReviewReferences } from '@/components/viewer';
import { syncContributionReviewState } from '@/components/ContributionDetail';
import { ArrowLeft, BookOpen, Check, Eye, GraduationCap, ListChecks, Mail, Megaphone, PencilLine, Plus, Send, ShieldCheck, Trash2, Upload, Users, X } from 'lucide-react';
import type { Role, Profile, Subject, Contribution, Feedback, AdminNote, NoteFeedbackItem } from '@/types';
import { supabase } from '@/lib/supabase';

export function AdminDashboard({ profile, navigate }: { profile: Profile; navigate: (path: string) => void }): JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [noteFeedback, setNoteFeedback] = useState<(NoteFeedbackItem & { admin_notes?: { title: string } | null })[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [to, setTo] = useState(''); const [nTitle, setNTitle] = useState(''); const [nMsg, setNMsg] = useState(''); const [nBusy, setNBusy] = useState(false); const [nNotice, setNNotice] = useState('');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [pending, setPending] = useState<Contribution[]>([]);
  const [teacherContribs, setTeacherContribs] = useState<Contribution[]>([]);
  const [selected, setSelected] = useState<Contribution | null>(null);
  const [selectedReviews, setSelectedReviews] = useState<Feedback[]>([]);
  const [editing, setEditing] = useState<Contribution | null>(null);
  const [editValues, setEditValues] = useState({ title: '', summary: '', description: '', code: '', github_url: '' });
  const deleteContribution = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this contribution permanently? This cannot be undone.')) return;
    await supabase.from('contribution_files').delete().eq('contribution_id', id);
    await supabase.from('feedback').delete().eq('contribution_id', id);
    const { error } = await supabase.from('contributions').delete().eq('id', id);
    setMessage(error ? friendlyError() : 'Contribution deleted.');
    if (!error) await load();
  };
  const openEdit = (item: Contribution): void => {
    setEditValues({ title: item.title, summary: item.summary || '', description: item.description || '', code: item.code || '', github_url: item.github_url || '' });
    setEditing(item);
  };
  const saveEdit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    const { error } = await supabase.from('contributions').update({ title: editValues.title, summary: editValues.summary, description: editValues.description || null, code: editValues.code || null, github_url: editValues.github_url || null }).eq('id', editing.id);
    setMessage(error ? friendlyError() : 'Contribution updated.');
    setBusy(false);
    if (!error) { setEditing(null); await load(); }
  };
  const [review, setReview] = useState({ feedback: '', score: '80', status: 'approved' as 'approved' | 'needs_improvement' });
  const [newSubject, setNewSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (): Promise<void> => {
    const [p, s, c, nf] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('subjects').select('*').order('name'),
      supabase.from('contributions').select('*, subjects(*), profiles(*)').order('created_at', { ascending: false }),
      supabase.from('note_feedback').select('*, admin_notes(title), profiles(role)').order('created_at', { ascending: false }).limit(6)
    ]);
    setProfiles((p.data || []) as Profile[]);
    setSubjects((s.data || []) as Subject[]);
    setPending((c.data || []).filter((item: Contribution) => item.status === 'pending') as Contribution[]);
    setTeacherContribs((c.data || []).filter((item: Contribution) => item.profiles?.role === 'teacher') as Contribution[]);
    setNoteFeedback((nf.data || []) as (NoteFeedbackItem & { admin_notes?: { title: string } | null })[]);
    setPeople((p.data || []).filter((x: Profile) => x.id !== profile.id) as Profile[]);
  };
  useEffect(() => { void load(); }, []);
  useLiveRefresh(() => void load());
  useEffect(() => { (async () => { if (!selected) { setSelectedReviews([]); return; } const r = await supabase.from('feedback').select('*').eq('contribution_id', selected.id).order('created_at', { ascending: false }); setSelectedReviews((r.data || []) as Feedback[]); })(); }, [selected]);
  const removeReview = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this review? The student will no longer see this feedback.')) return;
    const { error } = await supabase.from('feedback').delete().eq('id', id);
    if (error) setMessage(friendlyError()); else { setMessage('Review deleted.'); setSelectedReviews((rows) => rows.filter((r) => r.id !== id)); if (selected) await syncContributionReviewState(selected.id); }
    await load();
  };
  const sendNotification = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!to || !nTitle.trim() || !nMsg.trim()) { setNNotice('Choose a recipient and fill in both fields.'); return; }
    setNBusy(true); setNNotice('');
    const { error } = await supabase.from('notifications').insert({ user_id: to, title: nTitle.trim(), message: nMsg.trim(), type: 'message' });
    setNBusy(false);
    if (error) { setNNotice(friendlyError()); return; }
    setNTitle(''); setNMsg('');
    setNNotice('Notification sent.');
  };
  const changeRole = async (id: string, role: Role): Promise<void> => {
    const { error } = await supabase.rpc('set_profile_role', { p_profile_id: id, p_role: role });
    setMessage(error ? friendlyError() : 'Role updated.');
    if (!error) await load();
  };
  const deleteUser = async (user: Profile): Promise<void> => {
    if (!window.confirm(`Delete ${user.full_name || 'this user'} permanently? All of their contributions, feedback and notes will be removed. This cannot be undone.`)) return;
    const { data } = await supabase.rpc('delete_user', { p_user_id: user.id });
    const failed = (data as { error?: { message?: string } } | null)?.error?.message;
    setMessage(failed ? failed : `${user.full_name || 'User'} deleted.`);
    if (!failed) await load();
  };
  const addSubject = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!newSubject.trim()) return;
    const { error } = await supabase.from('subjects').insert({ name: newSubject.trim() });
    setMessage(error ? 'That subject already exists or could not be added.' : 'Subject added.');
    setNewSubject('');
    if (!error) await load();
  };
  const submitReview = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selected || !review.feedback) { setMessage('Add feedback before saving the review.'); return; }
    const score = Number(review.score);
    if (score < 0 || score > 100) { setMessage('Score must be between 0 and 100.'); return; }
    setBusy(true);
    const { error: fbError } = await supabase.from('feedback').insert({ contribution_id: selected.id, teacher_id: profile.id, reviewer_name: profile.full_name || 'Administrator', reviewer_role: 'admin', feedback: review.feedback, score, status: review.status });
    if (fbError) { setMessage(friendlyError()); setBusy(false); return; }
    const { error: cError } = await supabase.from('contributions').update({ score, status: review.status }).eq('id', selected.id);
    if (cError) { setMessage(friendlyError()); setBusy(false); return; }
    await supabase.from('notifications').insert({ user_id: selected.student_id, title: review.status === 'approved' ? 'Contribution approved' : 'Feedback on your contribution', message: review.feedback, type: review.status });
    setMessage('Review saved and the student has been notified.');
    setSelected(null);
    setReview({ feedback: '', score: '80', status: 'approved' });
    setBusy(false);
    await load();
  };
  return <><PageHeader eyebrow="Platform control" title="Admin overview" description={`Signed in as ${profile.full_name || 'administrator'}. Manage access, curriculum, scoring, and the audit trail.`} action={<span className="inline-flex items-center gap-2 rounded-xl bg-[#e7f7f1] px-3 py-2 text-xs font-bold text-[#087f78]"><ShieldCheck className="h-4 w-4" />Admin access</span>} />{message && <div className="mb-6 rounded-xl bg-[#effbf5] px-4 py-3 text-sm text-[#176345]">{message}</div>}<div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"><StatCard label="Users" value={String(profiles.length)} detail="All platform profiles" icon={Users} onClick={() => navigate('/students')} title="Open student directory" /><StatCard label="Students" value={String(profiles.filter((p) => p.role === 'student').length)} detail="Learner accounts" icon={GraduationCap} onClick={() => navigate('/students')} title="Open student directory" /><StatCard label="Pending reviews" value={String(pending.length)} detail="Waiting for approval" icon={ListChecks} onClick={() => document.getElementById('approval-queue')?.scrollIntoView({ behavior: 'smooth' })} title="Jump to approval queue" /><StatCard label="Subjects" value={String(subjects.length)} detail="Learning areas" icon={BookOpen} onClick={() => document.getElementById('subjects-panel')?.scrollIntoView({ behavior: 'smooth' })} title="Jump to subjects" /></div>
  <section className="card mt-6 p-6"><div className="flex items-center gap-3"><div className="rounded-xl bg-[#e7f7f1] p-2.5 text-[#087f78]"><Mail className="h-5 w-5" /></div><div><h2 className="text-lg font-bold">Feedback on your notes</h2><p className="mt-0.5 text-sm text-[#6c8589]">What students and teachers are saying about the notes you published.</p></div></div>{noteFeedback.length ? <div className="mt-5 space-y-3">{noteFeedback.map((f) => <div key={f.id} className="rounded-xl bg-[#f6faf8] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex min-w-0 flex-wrap items-center gap-2"><span className="truncate text-sm font-bold text-[#185464]">{f.reviewer_name}</span><RoleBadge role={f.role || f.profiles?.role} /></span><span className="shrink-0 text-xs text-[#8ca1a3]">on “{f.admin_notes?.title || 'a note'}” · {formatDate(f.created_at.slice(0, 10))}</span></div><p className="mt-2 text-sm leading-6 text-[#536e74]">{f.feedback}</p><button className="mt-3 text-xs font-bold text-[#087f78] hover:underline" onClick={() => navigate(`/admin-notes/${f.note_id}`)}>Open note →</button></div>)}</div> : <p className="mt-5 text-sm text-[#6c8589]">No note feedback yet. Comments from students and teachers will appear here.</p>}</section>
  <section className="card mt-6 p-6"><div className="flex items-center gap-3"><div className="rounded-xl bg-[#ede9fe] p-2.5 text-[#6d5ae0]"><Megaphone className="h-5 w-5" /></div><div><h2 className="text-lg font-bold">Send a notification</h2><p className="mt-0.5 text-sm text-[#6c8589]">Message any teacher or student directly — it lands in their notifications instantly.</p></div></div>{nNotice && <p className="mt-3 text-sm text-[#176345]">{nNotice}</p>}<form onSubmit={sendNotification} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.2fr_1.4fr_auto]"><select className="field" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose recipient…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username} · {p.role}</option>)}</select><input className="field" placeholder="Title" value={nTitle} onChange={(e) => setNTitle(e.target.value)} /><input className="field" placeholder="Message" value={nMsg} onChange={(e) => setNMsg(e.target.value)} /><button className="btn-primary inline-flex items-center justify-center gap-2" disabled={nBusy}>{nBusy ? 'Sending…' : <><Send className="h-4 w-4" />Send</>}</button></form></section>
  <section id="approval-queue" className="card mt-6 p-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Approval queue</h2><p className="mt-1 text-sm text-[#6c8589]">Contributions waiting for admin review.</p></div></div>{pending.length ? <div className="mt-5 space-y-3">{pending.map((item) => <div key={item.id} className="flex w-full items-center justify-between rounded-xl border border-[#e5efec] p-4 text-left transition hover:border-[#9ad7c5] hover:bg-[#f6fcf9]"><button onClick={() => setSelected(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><div className="min-w-0"><p className="truncate text-sm font-bold text-[#185464]">{item.title}</p><p className="mt-1 text-xs text-[#8ca1a3]">{item.profiles?.full_name || 'Student'} · {item.subjects?.name || 'Uncategorized'} · {formatDate(item.contribution_date)}</p></div><StatusPill status={item.status} /></button><div className="ml-3 flex shrink-0 items-center gap-1"><button title="Edit contribution content" onClick={() => openEdit(item)} className="rounded-lg p-2 text-[#6c8589] transition hover:bg-[#e7f7f1] hover:text-[#087f78]"><PencilLine className="h-4 w-4" /></button><button title="Delete contribution" onClick={() => void deleteContribution(item.id)} className="rounded-lg p-2 text-[#6c8589] transition hover:bg-[#fff4f4] hover:text-[#a33b3b]"><Trash2 className="h-4 w-4" /></button></div></div>)} </div> : <div className="mt-5"><EmptyState icon={Check} title="All caught up" text="No contributions are waiting for approval right now." /></div>}</section>
  <section className="card mt-6 p-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Teacher contributions</h2><p className="mt-1 text-sm text-[#6c8589]">Work published by teachers — visible to students and admins without approval.</p></div></div>{teacherContribs.length ? <div className="mt-5 space-y-3">{teacherContribs.map((item) => <div key={item.id} className="flex w-full items-center justify-between rounded-xl border border-[#e5efec] p-4 text-left transition hover:border-[#9ad7c5] hover:bg-[#f6fcf9]"><button onClick={() => navigate(`/contributions/${item.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><div className="min-w-0"><p className="truncate text-sm font-bold text-[#185464]">{item.title}</p><p className="mt-1 text-xs text-[#8ca1a3]">{item.profiles?.full_name || 'Teacher'} · {item.subjects?.name || 'Uncategorized'} · {formatDate(item.contribution_date)}</p></div><StatusPill status={item.status} /></button><div className="ml-3 flex shrink-0 items-center gap-1"><button title="View contribution" onClick={() => navigate(`/contributions/${item.id}`)} className="rounded-lg p-2 text-[#6c8589] transition hover:bg-[#e7f7f1] hover:text-[#087f78]"><Eye className="h-4 w-4" /></button><button title="Delete contribution" onClick={() => void deleteContribution(item.id)} className="rounded-lg p-2 text-[#6c8589] transition hover:bg-[#fff4f4] hover:text-[#a33b3b]"><Trash2 className="h-4 w-4" /></button></div></div>)} </div> : <div className="mt-5"><EmptyState icon={BookOpen} title="No teacher contributions yet" text="When teachers publish work, it will appear here for everyone." /></div>}</section>
  <AdminNotesBoard navigate={navigate} profile={profile} />
  <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.75fr]"><section className="card p-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Users and roles</h2><p className="mt-1 text-sm text-[#6c8589]">Role changes are recorded securely.</p></div></div><div className="mt-5 space-y-3">{profiles.map((user) => <div key={user.id} className="flex flex-col gap-3 rounded-xl border border-[#e5efec] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><Avatar profile={user} size="sm" /><div><p className="text-sm font-bold">{user.full_name || 'Unnamed user'}</p><p className="text-xs text-[#8ca1a3]">{user.username || user.id.slice(0, 8)}</p></div></div><div className="flex items-center gap-2"><select className="field max-w-[160px] py-2 text-xs" value={user.role} onChange={(e) => void changeRole(user.id, e.target.value as Role)}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select>{user.role !== 'admin' && user.id !== profile.id && <button title="Delete user" onClick={() => void deleteUser(user)} className="rounded-lg p-2 text-[#b05e5e] transition hover:bg-[#fbeeee] hover:text-[#a03333]"><Trash2 className="h-4 w-4" /></button>}</div></div>)}</div></section><div className="space-y-6"><section id="subjects-panel" className="card p-6"><h2 className="text-lg font-bold">Subjects</h2><form onSubmit={addSubject} className="mt-4 flex gap-2"><input className="field" placeholder="New subject" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} /><button className="btn-primary px-3"><Plus className="h-4 w-4" /></button></form><div className="mt-4 flex flex-wrap gap-2">{subjects.map((subject) => <span key={subject.id} className="rounded-full bg-[#edf7f4] px-3 py-1.5 text-xs font-semibold text-[#087f78]">{subject.name}</span>)}</div></section><AdminNotesSection profile={profile} subjects={subjects} /></div></div>
  {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#061c2c]/60 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6"><div className="flex items-start justify-between"><div><p className="eyebrow">Modify contribution</p><h2 className="mt-2 text-2xl font-bold">Edit content</h2><p className="mt-1 text-sm text-[#6c8589]">{editing.profiles?.full_name || 'Student'} · {editing.subjects?.name}</p></div><button onClick={() => setEditing(null)} className="rounded-lg p-2 hover:bg-[#f2f8f6]"><X className="h-5 w-5" /></button></div><form onSubmit={saveEdit} className="mt-6 space-y-4"><input className="field" placeholder="Title" value={editValues.title} onChange={(e) => setEditValues({ ...editValues, title: e.target.value })} /><textarea className="field min-h-20" placeholder="Summary" value={editValues.summary} onChange={(e) => setEditValues({ ...editValues, summary: e.target.value })} /><textarea className="field min-h-28" placeholder="Description" value={editValues.description} onChange={(e) => setEditValues({ ...editValues, description: e.target.value })} /><textarea className="field min-h-32 font-mono text-xs" placeholder="Code or notes" value={editValues.code} onChange={(e) => setEditValues({ ...editValues, code: e.target.value })} /><input className="field" type="url" placeholder="GitHub URL" value={editValues.github_url} onChange={(e) => setEditValues({ ...editValues, github_url: e.target.value })} /><button className="btn-primary w-full" disabled={busy || !editValues.title || !editValues.summary}>{busy ? 'Saving…' : 'Save changes'}</button></form></div></div>}
  {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#061c2c]/60 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6"><div className="flex items-start justify-between"><div><p className="eyebrow">Review contribution</p><h2 className="mt-2 text-2xl font-bold">{selected.title}</h2><p className="mt-1 text-sm text-[#6c8589]">{selected.profiles?.full_name || 'Student'} · {selected.subjects?.name}</p></div><button onClick={() => setSelected(null)} className="rounded-lg p-2 hover:bg-[#f2f8f6]"><X className="h-5 w-5" /></button></div><div className="mt-6 rounded-xl bg-[#f5faf8] p-4"><p className="text-sm font-bold">Summary</p><p className="mt-2 text-sm leading-6 text-[#536e74]">{selected.summary}</p>{selected.description && <><p className="mt-4 text-sm font-bold">Description</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#536e74]">{selected.description}</p></>}{selected.code && <CodeBlock code={selected.code} compact />}<ReviewReferences contributionId={selected.id} githubUrl={selected.github_url} /></div>{selectedReviews.length > 0 && <div className="mt-4 border-t border-[#e5efec] pt-4"><p className="text-sm font-bold">Reviews given</p><div className="mt-3 space-y-2">{selectedReviews.map((r) => <div key={r.id} className="flex items-start justify-between gap-3 rounded-xl bg-white p-3"><div className="min-w-0"><p className="flex flex-wrap items-center gap-2 text-sm font-bold"><span className="truncate">{r.reviewer_name || 'Reviewer'}</span><RoleBadge role={r.reviewer_role} /></p><p className="mt-1 text-sm leading-5 text-[#536e74]">{r.feedback}</p></div><div className="flex shrink-0 items-center gap-2"><span className="text-sm font-bold text-[#087f78]">{r.score}%</span>{(profile.role === 'admin' || r.teacher_id === profile.id) && <button title="Delete this review" onClick={() => void removeReview(r.id)} className="rounded-lg p-1.5 text-[#6c8589] transition hover:bg-[#fff4f4] hover:text-[#a33b3b]"><Trash2 className="h-4 w-4" /></button>}</div></div>)}</div></div>}<form onSubmit={submitReview} className="mt-6 space-y-4"><textarea className="field min-h-28" placeholder="Write constructive feedback" value={review.feedback} onChange={(e) => setReview({ ...review, feedback: e.target.value })} /><div className="grid gap-4 sm:grid-cols-2"><input className="field" type="number" min="0" max="100" placeholder="Score" value={review.score} onChange={(e) => setReview({ ...review, score: e.target.value })} /><select className="field" value={review.status} onChange={(e) => setReview({ ...review, status: e.target.value as 'approved' | 'needs_improvement' })}><option value="approved">Approve contribution</option><option value="needs_improvement">Needs improvement</option></select></div><button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save review'}</button></form></div></div>}
  </>;
}

export function useAdminNotes(): { notes: AdminNote[]; reload: () => Promise<void> } {
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const reload = async (): Promise<void> => { const { data } = await supabase.from('admin_notes').select('*, subjects(name), profiles(full_name)').order('created_at', { ascending: false }); setNotes((data || []) as AdminNote[]); };
  useEffect(() => { void reload(); }, []);
  return { notes, reload };
}

export function AdminNotesSection({ profile, subjects }: { profile: Profile; subjects: Subject[] }): JSX.Element {
  const { notes, reload } = useAdminNotes();
  const [subjectId, setSubjectId] = useState('');
  const [values, setValues] = useState({ title: '', summary: '', description: '', code: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setMessage('');
    if (!values.title.trim() || !values.summary.trim()) { setMessage('Add a title and a summary.'); return; }
    setBusy(true);
    let filePath: string | null = null; let fileName: string | null = null; let fileType: string | null = null;
    if (file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      if (!isUploadAllowed(file)) { setMessage('That file type is not supported. PDF, Office documents, images, video, audio, ZIP archives, code files, and Google Docs exports are accepted.'); setBusy(false); return; }
      const path = `admin-notes/${profile.id}/${Date.now()}-${safeName}`;
      const upload = await supabase.storage.from('study-notes').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (upload.error) { setMessage('The file could not be uploaded. Please try again.'); setBusy(false); return; }
      filePath = path; fileName = file.name; fileType = file.type || 'application/octet-stream';
    }
    const { error } = await supabase.from('admin_notes').insert({ subject_id: subjectId || null, title: values.title.trim(), summary: values.summary.trim(), description: values.description.trim() || null, code: values.code.trim() || null, file_path: filePath, file_name: fileName, file_type: fileType });
    if (error) { setMessage(friendlyError()); setBusy(false); return; }
    setValues({ title: '', summary: '', description: '', code: '' }); setFile(null); setSubjectId('');
    setMessage('Admin note published. It is visible to every student and teacher now.');
    setBusy(false); await reload();
  };
  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this admin note?')) return;
    await supabase.from('admin_notes').delete().eq('id', id);
    await reload();
  };
  return <section className="card p-6"><h2 className="text-lg font-bold">Learning notes for everyone</h2><p className="mt-1 text-sm text-[#6c8589]">Publish notes to all students and teachers — no approval needed.</p><form onSubmit={submit} className="mt-4 space-y-3"><select className="field" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">Choose a subject (optional)</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><input className="field" placeholder="Note title" value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} /><textarea className="field min-h-16" placeholder="Summary — one or two lines" value={values.summary} onChange={(e) => setValues({ ...values, summary: e.target.value })} /><textarea className="field min-h-24" placeholder="Full description" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} /><textarea className="field min-h-28 font-mono text-xs" placeholder="Code example (optional)" value={values.code} onChange={(e) => setValues({ ...values, code: e.target.value })} /><label title={uploadTypeHint} className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#aad9ca] bg-[#f5fcf9] p-3"><Upload className="h-4 w-4 text-[#087f78]" /><span className="min-w-0 truncate text-xs font-semibold text-[#185464]">{file ? file.name : 'Attach a file (optional)'}</span><input className="hidden" type="file" accept={UPLOAD_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>{message && <p className="text-xs text-[#176345]">{message}</p>}<button className="btn-primary w-full" disabled={busy}>{busy ? 'Publishing…' : 'Publish note'}</button></form>{notes.length > 0 && <div className="mt-5 space-y-2 border-t border-[#e5efec] pt-4"><p className="text-xs font-bold uppercase tracking-wide text-[#8ca1a3]">Published notes ({notes.length})</p>{notes.slice(0, 5).map((note) => <div key={note.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#f6faf8] px-3 py-2"><span className="min-w-0 truncate text-xs font-semibold text-[#185464]">{note.title}{note.subjects ? ` · ${note.subjects.name}` : ''}</span><button title="Delete note" onClick={() => void remove(note.id)} className="shrink-0 rounded-lg p-1.5 text-[#6c8589] transition hover:bg-[#fff4f4] hover:text-[#a33b3b]"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>}</section>;
}

export function AdminNotesBoard({ navigate, profile }: { navigate: (path: string) => void; profile?: Profile }): JSX.Element {
  const { notes, reload } = useAdminNotes();
  const removeNote = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this note for everyone?')) return;
    const { error } = await supabase.from('admin_notes').delete().eq('id', id);
    if (!error) await reload();
  };
  if (!notes.length) return null as unknown as JSX.Element;
  return <section className="card mt-6 p-6"><div className="flex items-center gap-3"><div className="rounded-xl bg-[#e7f7f1] p-2 text-[#087f78]"><BookOpen className="h-5 w-5" /></div><div><p className="text-lg font-bold">Notes from the admin</p><p className="text-sm text-[#6c8589]">Learning references shared by platform administrators.</p></div></div><div className="mt-5 grid gap-3 md:grid-cols-2">{notes.slice(0, 4).map((note) => <div key={note.id} className="rounded-xl border border-[#e5efec] p-4"><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-[#e7f7f1] px-2.5 py-1 text-[10px] font-bold text-[#087f78]">{note.subjects?.name || 'General'}</span><div className="flex items-center gap-1"><button title="Open this note" onClick={() => navigate(`/admin-notes/${note.id}`)} className="rounded-lg p-1.5 text-[#6c8589] transition hover:bg-[#e7f7f1] hover:text-[#087f78]"><Eye className="h-4 w-4" /></button>{profile?.role === 'admin' && <button title="Delete note" onClick={() => void removeNote(note.id)} className="rounded-lg p-1.5 text-[#6c8589] transition hover:bg-[#fff4f4] hover:text-[#a33b3b]"><Trash2 className="h-4 w-4" /></button>}</div></div><h3 className="mt-2 truncate font-bold text-[#185464]">{note.title}</h3>{note.summary && <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#6c8589]">{note.summary}</p>}</div>)}</div>{notes.length > 4 && <p className="mt-3 text-xs text-[#8ca1a3]">{notes.length - 4} more on the learning path page.</p>}</section>;
}

export function AdminNoteDetail({ navigate, noteId, profile }: { navigate: (path: string) => void; noteId: string; profile: Profile }): JSX.Element {
  const [note, setNote] = useState<AdminNote | null>(null);
  const [comments, setComments] = useState<NoteFeedbackItem[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async (): Promise<void> => { const n = await supabase.from('admin_notes').select('*, subjects(name), profiles(full_name)').eq('id', noteId).maybeSingle(); const fb = await supabase.from('note_feedback').select('*, profiles(role)').eq('note_id', noteId).order('created_at', { ascending: true }); setNote((n.data as AdminNote) ?? null); setComments((fb.data || []) as NoteFeedbackItem[]); setLoading(false); };
  useEffect(() => { void load(); }, [noteId]);
  const submit = async (event: FormEvent): Promise<void> => { event.preventDefault(); if (!text.trim()) return; setBusy(true); setMessage(''); const { error } = await supabase.from('note_feedback').insert({ note_id: noteId, reviewer_name: profile.full_name || profile.username || 'Member', role: profile.role, feedback: text.trim() }); if (error) { setMessage(friendlyError()); setBusy(false); return; } setText(''); setBusy(false); await load(); };
  const removeComment = async (id: string): Promise<void> => { const { error } = await supabase.from('note_feedback').delete().eq('id', id); if (error) setMessage(friendlyError()); await load(); };
  if (loading) return <LoadingPanel />;
  if (!note) return <NotFound navigate={() => navigate('/dashboard')} />;
  return <><button className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-[#6c8589] hover:text-[#087f78]" onClick={() => navigate('/dashboard')}><ArrowLeft className="h-4 w-4" />Back</button><div className="mb-8"><div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-[#e7f7f1] px-2.5 py-1 text-[10px] font-bold text-[#087f78]">{note.subjects?.name || 'General'}</span><span className="text-sm text-[#8ca1a3]">By {note.profiles?.full_name || 'Administrator'} · {formatDate(note.created_at.slice(0, 10))}</span></div><h1 className="mt-3 text-4xl font-bold tracking-tight text-[#102a3a]">{note.title}</h1>{note.summary && <p className="mt-3 max-w-2xl text-base leading-7 text-[#61777c]">{note.summary}</p>}</div><div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]"><section className="card p-6"><h2 className="text-lg font-bold">About this note</h2><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#536e74]">{note.description || 'No additional description.'}</p>{note.code && <CodeBlock code={note.code} />}</section><section className="card p-6"><h2 className="font-bold">Attachment</h2>{note.file_path ? <NoteFileLink bucket="study-notes" path={note.file_path} name={note.file_name || 'Download'} /> : <p className="mt-4 text-sm text-[#8ca1a3]">No file attached to this note.</p>}</section></div><section className="card mt-6 p-6"><h2 className="text-lg font-bold">Feedback on this note</h2><p className="mt-1 text-sm text-[#6c8589]">Questions and thoughts from students and teachers.</p>{message && <p className="mt-3 text-sm text-[#a33b3b]">{message}</p>}<form onSubmit={submit} className="mt-4 space-y-3"><textarea className="field min-h-20" placeholder="Share your feedback on this note…" value={text} onChange={(e) => setText(e.target.value)} /><button className="btn-primary" disabled={busy || !text.trim()}>{busy ? 'Posting…' : 'Post feedback'}</button></form><div className="mt-5 space-y-3">{comments.length ? comments.map((c) => <div key={c.id} className="rounded-xl bg-[#f6faf8] p-4"><div className="flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-bold text-[#185464]">{c.reviewer_name}</span><RoleBadge role={c.role || c.profiles?.role} /></span><div className="flex items-center gap-2"><span className="text-xs text-[#8ca1a3]">{formatDate(c.created_at.slice(0, 10))}</span>{(c.user_id === profile.id || profile.role === 'admin') && <button title="Delete comment" onClick={() => void removeComment(c.id)} className="rounded-lg p-1.5 text-[#6c8589] transition hover:bg-[#fff4f4] hover:text-[#a33b3b]"><Trash2 className="h-4 w-4" /></button>}</div></div><p className="mt-2 text-sm leading-6 text-[#536e74]">{c.feedback}</p></div>) : <p className="text-sm text-[#8ca1a3]">No feedback yet. Be the first to share your thoughts.</p>}</div></section></>;
}
