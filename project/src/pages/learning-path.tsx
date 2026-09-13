import { useState, useEffect, FormEvent } from 'react';
import { formatDate, friendlyError } from '@/lib/ui';
import { PageHeader, StatusPill } from '@/components/shared';
import { AdminNotesBoard } from '@/pages/admin';
import { FileViewer } from '@/components/viewer';
import { Students } from '@/pages/teacher';
import { Activity as ActivityIcon, Cloud, Code2, Eye, FileText, Trash2, Upload, X } from 'lucide-react';
import type { Profile, Subject, Contribution, StudyNote, Syllabus } from '@/types';
import { supabase } from '@/lib/supabase';

export function SyllabusSection({ profile }: { profile: Profile }): JSX.Element {
  const [rows, setRows] = useState<Syllabus[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [target, setTarget] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const isStaff = profile.role === 'teacher' || profile.role === 'admin';
  const load = async (): Promise<void> => {
    const [s, subs] = await Promise.all([
      supabase.from('syllabus').select('*, subjects(id, name), profiles(full_name, role)').order('updated_at', { ascending: false }),
      supabase.from('subjects').select('*').order('name'),
    ]);
    setRows((s.data || []) as Syllabus[]);
    setSubjects((subs.data || []) as Subject[]);
  };
  useEffect(() => { void load(); }, []);
  const upload = async (): Promise<void> => {
    if (!target) { setMessage('Choose the subject this syllabus belongs to.'); return; }
    if (!file) { setMessage('Choose a PDF or image file.'); return; }
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { setMessage('The syllabus must be a PDF or an image.'); return; }
    if (file.size > 10 * 1024 * 1024) { setMessage('Keep syllabus files under 10 MB.'); return; }
    setBusy(true); setMessage('');
    const existing = rows.find((r) => r.subject_id === target);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `syllabus/${crypto.randomUUID()}-${safeName}`;
    const up = await supabase.storage.from('study-notes').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { setMessage('The syllabus could not be uploaded. Please try again.'); setBusy(false); return; }
    const payload = { subject_id: target, title: 'Syllabus', file_path: path, file_name: file.name, file_type: file.type, uploaded_by: profile.id };
    const result = existing
      ? await supabase.from('syllabus').upsert({ ...payload, id: existing.id }, { onConflict: 'id' }).select().maybeSingle()
      : await supabase.from('syllabus').insert(payload).select().maybeSingle();
    if (result.error) { await supabase.storage.from('study-notes').remove([path]); setMessage(friendlyError()); setBusy(false); return; }
    if (existing?.file_path) await supabase.storage.from('study-notes').remove([existing.file_path]);
    setFile(null); setTarget(''); setMessage('Syllabus published.'); await load(); setBusy(false);
  };
  const remove = async (row: Syllabus): Promise<void> => {
    if (!window.confirm(`Remove the ${row.subjects?.name || ''} syllabus? Students will no longer see it.`)) return;
    const { error } = await supabase.from('syllabus').delete().eq('id', row.id);
    if (error) { setMessage(friendlyError()); return; }
    if (row.file_path) await supabase.storage.from('study-notes').remove([row.file_path]);
    await load();
  };
  const openFile = async (row: Syllabus): Promise<void> => {
    const result = await supabase.storage.from('study-notes').createSignedUrl(row.file_path, 3600);
    if (result.data?.signedUrl) setViewingSyllabus({ url: result.data.signedUrl, name: row.file_name });
  };
  const [viewingSyllabus, setViewingSyllabus] = useState<{ url: string; name: string } | null>(null);
  return <section className="mt-8"><div className="mb-5"><p className="eyebrow">Course outline</p><h2 className="mt-2 text-2xl font-bold text-[#102a3a]">Syllabus</h2><p className="mt-2 text-sm leading-6 text-[#6c8589]">The official syllabus for each subject — same document for every student.{isStaff ? ' Teachers and admins keep it up to date here.' : ''}</p></div>{message && <p className="mb-4 text-sm text-[#176345]">{message}</p>}{isStaff && <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_1.4fr_auto_auto]"><select className="field" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Subject…</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}{rows.some((r) => r.subject_id === s.id) ? ' (replace)' : ''}</option>)}</select><label className="btn-secondary cursor-pointer justify-center"><Upload className="h-4 w-4" />{file ? file.name : 'Choose PDF or image'}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label><button className="btn-primary justify-center" disabled={busy} onClick={() => void upload()}>{busy ? 'Publishing…' : 'Publish syllabus'}</button></div>}<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{subjects.map((s) => { const row = rows.find((r) => r.subject_id === s.id); return <div key={s.id} className="card flex flex-col p-5"><div className="flex items-center justify-between"><span className="rounded-full bg-[#e7f7f1] px-2.5 py-1 text-[10px] font-bold text-[#087f78]">{s.name}</span>{row && isStaff && <button title="Delete this syllabus" onClick={() => void remove(row)} className="rounded-lg p-1.5 text-[#6c8589] transition hover:bg-[#fff4f4] hover:text-[#a33b3b]"><Trash2 className="h-4 w-4" /></button>}</div>{row ? <><p className="mt-3 truncate text-sm font-bold text-[#185464]">{row.file_name}</p><p className="mt-1 text-xs text-[#8ca1a3]">Updated {formatDate(row.updated_at?.slice(0, 10) || row.created_at.slice(0, 10))}{row.profiles ? ` · by ${row.profiles.full_name || 'staff'}` : ''}</p><button className="btn-secondary mt-4 justify-center" onClick={() => void openFile(row)}><FileText className="h-4 w-4" />View syllabus</button></> : <p className="mt-3 text-sm text-[#8ca1a3]">No syllabus published yet.{isStaff ? ' Upload it above.' : ''}</p>}</div>; })}</div>{viewingSyllabus && <FileViewer url={viewingSyllabus.url} name={viewingSyllabus.name} onClose={() => setViewingSyllabus(null)} />}</section>;
}

export function LearningPath({ profile, navigate }: { profile: Profile; navigate: (path: string) => void }): JSX.Element { const [items, setItems] = useState<Contribution[]>([]); useEffect(() => { (async () => { const { data } = await supabase.from('contributions').select('*, subjects(*)').eq('student_id', profile.id); setItems((data || []) as Contribution[]); })(); }, [profile.id]); return <><PageHeader eyebrow="Keep exploring" title="Learning path" description="Your progress across the core areas of fullstack development." /><AdminNotesBoard navigate={navigate} profile={profile} /><SyllabusSection profile={profile} /><div className="mt-6 grid gap-5 md:grid-cols-3">{[{ name: 'Frontend', icon: Code2, text: 'Interfaces, accessibility, and experiences.' }, { name: 'Backend', icon: ActivityIcon, text: 'Data, APIs, and reliable application logic.' }, { name: 'Cloud Computing', icon: Cloud, text: 'Deployment, infrastructure, and scale.' }].map((path) => { const subjectItems = items.filter((item) => item.subjects?.name === path.name); const count = subjectItems.length; const Icon = path.icon; return <div key={path.name} className="card p-6"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e7f7f1] text-[#087f78]"><Icon className="h-6 w-6" /></div><h2 className="mt-6 text-xl font-bold">{path.name}</h2><p className="mt-2 text-sm leading-6 text-[#6c8589]">{path.text}</p><div className="mt-6 flex items-end justify-between"><div><p className="text-3xl font-bold text-[#087f78]">{count}</p><p className="text-xs text-[#8ca1a3]">{count === 1 ? 'contribution' : 'contributions'}</p></div>{count > 0 && <button title="View these contributions" onClick={() => navigate(`/contributions?subject=${encodeURIComponent(path.name)}`)} className="inline-flex items-center gap-1.5 rounded-full bg-[#f0f8f5] px-3 py-1.5 text-xs font-bold text-[#087f78] transition hover:bg-[#e7f7f1]"><Eye className="h-4 w-4" />View</button>}</div>{count > 0 && <div className="mt-4 space-y-2">{subjectItems.slice(0, 3).map((item) => <button key={item.id} onClick={() => navigate(`/contributions/${item.id}`)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-[#f6faf8] px-3 py-2 text-left transition hover:bg-[#e7f7f1]"><span className="min-w-0 truncate text-xs font-semibold text-[#185464]">{item.title}</span><StatusPill status={item.status} /></button>)}</div>}</div>; })}</div><NotesSection profile={profile} /></>; }

export function NotesSection({ profile }: { profile: Profile }): JSX.Element {
  const categories = ['Frontend', 'Backend', 'Cloud Computing'] as const;
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [category, setCategory] = useState<(typeof categories)[number]>('Frontend');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async (): Promise<void> => { const result = await supabase.from('study_notes').select('*, profiles(full_name, role)').order('created_at', { ascending: false }); setNotes((result.data || []) as StudyNote[]); };
  useEffect(() => { void load(); }, [profile.id]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setMessage('');
    if (!title.trim() || !file) { setMessage('Add a note name and choose a PDF or image.'); return; }
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { setMessage('Notes must be a PDF or an image.'); return; }
    if (file.size > 10 * 1024 * 1024) { setMessage('Keep note files under 10 MB.'); return; }
    setBusy(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `${profile.id}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from('study-notes').upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) { setMessage('The note could not be uploaded. Please try again.'); setBusy(false); return; }
    const result = await supabase.from('study_notes').insert({ category, title: title.trim(), description: description.trim(), file_path: path, file_name: file.name, file_type: file.type }).select().maybeSingle();
    if (result.error || !result.data) { await supabase.storage.from('study-notes').remove([path]); setMessage('The note could not be saved. Please try again.'); setBusy(false); return; }
    setTitle(''); setDescription(''); setFile(null); setMessage('Note uploaded successfully.'); await load(); setBusy(false);
  };
  return <section className="mt-8"><div className="mb-5"><p className="eyebrow">Your reference library</p><h2 className="mt-2 text-2xl font-bold text-[#102a3a]">Upload learning notes</h2><p className="mt-2 text-sm leading-6 text-[#6c8589]">Notes you upload are shared with everyone — students, teachers, and admins — in one learning library.</p></div><div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]"><form onSubmit={submit} className="card space-y-4 p-6"><div><label className="mb-2 block text-sm font-semibold">Learning area</label><select className="field" value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number])}>{categories.map((item) => <option key={item}>{item}</option>)}</select></div><div><label className="mb-2 block text-sm font-semibold">Note name</label><input className="field" placeholder="e.g. CSS grid quick reference" value={title} onChange={(event) => setTitle(event.target.value)} /></div><div><label className="mb-2 block text-sm font-semibold">Description</label><textarea className="field min-h-28 resize-y" placeholder="What does this note cover?" value={description} onChange={(event) => setDescription(event.target.value)} /></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#aad9ca] bg-[#f5fcf9] p-4"><Upload className="h-5 w-5 text-[#087f78]" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#185464]">{file ? file.name : 'Choose a PDF or image'}</p><p className="mt-1 text-xs text-[#7b9295]">PDF, JPG, PNG, WEBP, or GIF · 10 MB maximum</p></div><input className="hidden" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>{message && <p className="text-sm text-[#176345]">{message}</p>}<button className="btn-primary w-full" disabled={busy}>{busy ? 'Uploading…' : 'Upload note'}<Upload className="h-4 w-4" /></button></form><div className="space-y-3">{notes.length === 0 ? <div className="card p-8 text-center"><FileText className="mx-auto h-9 w-9 text-[#9acfc0]" /><p className="mt-3 font-bold text-[#185464]">No notes in the library yet</p><p className="mt-1 text-sm text-[#7b9295]">Upload the first reference — everyone will see it here.</p></div> : notes.map((note) => <NoteCard key={note.id} note={note} profile={profile} onChanged={load} />)}</div></div></section>;
}

export function NoteCard({ note, profile, onChanged }: { note: StudyNote; profile: Profile; onChanged: () => Promise<void> | void }): JSX.Element {
  const [url, setUrl] = useState('');
  const [viewing, setViewing] = useState(false);
  const [managing, setManaging] = useState(false);
  const canManage = note.user_id === profile.id || profile.role === 'admin';
  useEffect(() => { (async () => { const result = await supabase.storage.from('study-notes').createSignedUrl(note.file_path, 3600); setUrl(result.data?.signedUrl || ''); })(); }, [note.file_path]);
  return <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#e7f7f1] px-2.5 py-1 text-[10px] font-bold text-[#087f78]">{note.category}</span><span className="text-xs text-[#8ca1a3]">{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(note.created_at))}</span>{note.profiles && <span className="flex items-center gap-1 text-xs font-semibold text-[#536e74]">{note.profiles.role === 'teacher' ? 'Teacher' : note.profiles.role === 'admin' ? 'Admin' : 'Student'}: {note.profiles.full_name || 'Member'}</span>}</div><h3 className="mt-3 font-bold text-[#185464]">{note.title}</h3>{note.description && <p className="mt-1 text-sm leading-6 text-[#6c8589]">{note.description}</p>}<p className="mt-3 truncate text-xs text-[#8ca1a3]">{note.file_name}</p></div><div className="flex shrink-0 items-center gap-2">{url ? <button onClick={() => setViewing(true)} className="btn-secondary"><FileText className="h-4 w-4" />Open note</button> : <span className="text-xs text-[#8ca1a3]">Preparing file…</span>}{canManage && <button title="View and edit this note" onClick={() => setManaging(true)} className="rounded-lg p-2.5 text-[#6c8589] transition hover:bg-[#eef7f4] hover:text-[#087f78]"><Eye className="h-4 w-4" /></button>}</div>{viewing && url && <FileViewer url={url} name={note.file_name || note.title} onClose={() => setViewing(false)} />}{managing && <NoteManageModal note={note} onClose={() => setManaging(false)} onChanged={onChanged} />}</div>;
}

// Eye-button modal: edit the note's text, replace or remove the file, or
// delete the note entirely. Owner or admin only (the button is hidden for
// everyone else, and the server enforces the same rule).

export function NoteManageModal({ note, onClose, onChanged }: { note: StudyNote; onClose: () => void; onChanged: () => Promise<void> | void }): JSX.Element {
  const categories = ['Frontend', 'Backend', 'Cloud Computing'];
  const [title, setTitle] = useState(note.title);
  const [description, setDescription] = useState(note.description || '');
  const [category, setCategory] = useState<string>(note.category);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const saveText = async (): Promise<void> => {
    if (!title.trim()) { setMessage('The note needs a name.'); return; }
    setBusy(true); setMessage('');
    const { error } = await supabase.from('study_notes').update({ title: title.trim(), description: description.trim(), category }).eq('id', note.id).eq('user_id', note.user_id);
    setBusy(false);
    if (error) { setMessage(friendlyError()); return; }
    await onChanged();
    onClose();
  };
  const replaceFile = async (): Promise<void> => {
    if (!newFile) { setMessage('Choose a new file first.'); return; }
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(newFile.type)) { setMessage('Notes must be a PDF or an image.'); return; }
    if (newFile.size > 10 * 1024 * 1024) { setMessage('Keep note files under 10 MB.'); return; }
    setBusy(true); setMessage('');
    const safeName = newFile.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `${note.user_id}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from('study-notes').upload(path, newFile, { contentType: newFile.type, upsert: false });
    if (upload.error) { setMessage('The new file could not be uploaded.'); setBusy(false); return; }
    const { error } = await supabase.from('study_notes').update({ file_path: path, file_name: newFile.name, file_type: newFile.type }).eq('id', note.id).eq('user_id', note.user_id);
    if (error) { await supabase.storage.from('study-notes').remove([path]); setMessage(friendlyError()); setBusy(false); return; }
    await supabase.storage.from('study-notes').remove([note.file_path]);
    await onChanged();
    onClose();
  };
  const removeFile = async (): Promise<void> => {
    if (!window.confirm('Remove the attached file from this note? The note stays, without a file.')) return;
    setBusy(true); setMessage('');
    const { error } = await supabase.from('study_notes').update({ file_path: '', file_name: '', file_type: '' }).eq('id', note.id).eq('user_id', note.user_id);
    setBusy(false);
    if (error) { setMessage(friendlyError()); return; }
    await supabase.storage.from('study-notes').remove([note.file_path]);
    await onChanged();
    onClose();
  };
  const deleteNote = async (): Promise<void> => {
    if (!window.confirm('Delete this note permanently? This cannot be undone.')) return;
    setBusy(true); setMessage('');
    const { error } = await supabase.from('study_notes').delete().eq('id', note.id).eq('user_id', note.user_id);
    if (error) { setBusy(false); setMessage(friendlyError()); return; }
    if (note.file_path) await supabase.storage.from('study-notes').remove([note.file_path]);
    await onChanged();
    onClose();
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#061c2c]/60 p-4" onClick={onClose}><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="eyebrow">Manage note</p><h2 className="mt-2 text-xl font-bold">{note.title}</h2></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-[#f2f8f6]"><X className="h-5 w-5" /></button></div>{message && <p className="mt-3 text-sm text-[#a33b3b]">{message}</p>}<div className="mt-5 space-y-4"><div><label className="mb-2 block text-sm font-semibold">Learning area</label><select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></div><div><label className="mb-2 block text-sm font-semibold">Note name</label><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></div><div><label className="mb-2 block text-sm font-semibold">Description</label><textarea className="field min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} /></div><div><label className="mb-2 block text-sm font-semibold">Attached file</label><p className="mb-2 truncate text-xs text-[#8ca1a3]">Current: {note.file_name || 'none'}</p><div className="flex flex-wrap items-center gap-2"><label className="btn-secondary cursor-pointer text-xs"><Upload className="h-3.5 w-3.5" />{newFile ? newFile.name : 'Replace file'}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} /></label>{note.file_name && <button type="button" className="text-xs font-semibold text-[#a33b3b]" onClick={() => void removeFile()}>Remove file</button>}</div></div></div><div className="mt-6 flex items-center justify-between gap-3"><button className="text-sm font-semibold text-[#a33b3b] transition hover:text-[#7d2b2b]" onClick={() => void deleteNote()}><span className="inline-flex items-center gap-1.5"><Trash2 className="h-4 w-4" />Delete note</span></button><div className="flex items-center gap-2"><button className="btn-secondary text-sm" onClick={onClose}>Cancel</button><button className="btn-primary text-sm" disabled={busy} onClick={() => void saveText()}>{busy ? 'Saving…' : 'Save changes'}</button></div></div><button className="mt-4 w-full rounded-lg bg-[#f5faf8] px-3 py-2 text-xs font-semibold text-[#087f78]" disabled={busy || !newFile} onClick={() => void replaceFile()}>{busy ? 'Uploading…' : 'Save new file (uploads the chosen replacement)'}</button></div></div>;
}
