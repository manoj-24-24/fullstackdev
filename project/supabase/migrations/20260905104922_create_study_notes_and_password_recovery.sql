/*
# Create private study notes and secure file storage

1. New Tables
- `study_notes`: user-owned note records.
- `study_notes.id`: unique note identifier.
- `study_notes.user_id`: authenticated owner, filled from the current session.
- `study_notes.category`: Frontend, Backend, or Cloud Computing.
- `study_notes.title`: name shown in the user's notes library.
- `study_notes.description`: optional explanation of the note.
- `study_notes.file_path`: private storage path.
- `study_notes.file_name`: original display filename.
- `study_notes.file_type`: validated PDF or image MIME type.
- `study_notes.created_at`: upload timestamp.

2. Storage
- Adds a private `study-notes` bucket.
- Limits files to 10 MB and PDF/image MIME types.
- Restricts storage access to the authenticated user's folder.

3. Security
- Enables RLS on `study_notes`.
- Adds separate authenticated-owner policies for select, insert, update, and delete.
- Storage policies use the first path segment as the owner ID.

4. Important notes
- Existing contributions, files, profiles, and users are unchanged.
- Notes are served through short-lived signed URLs rather than public links.
- This migration is safe to re-run.
*/

create table if not exists public.study_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  category text not null check (category in ('Frontend', 'Backend', 'Cloud Computing')),
  title text not null,
  description text not null default '',
  file_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  created_at timestamptz not null default now()
);

create index if not exists study_notes_user_created_idx on public.study_notes(user_id, created_at desc);
alter table public.study_notes enable row level security;

drop policy if exists study_notes_select on public.study_notes;
create policy study_notes_select on public.study_notes for select to authenticated using (user_id = auth.uid());
drop policy if exists study_notes_insert on public.study_notes;
create policy study_notes_insert on public.study_notes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists study_notes_update on public.study_notes;
create policy study_notes_update on public.study_notes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists study_notes_delete on public.study_notes;
create policy study_notes_delete on public.study_notes for delete to authenticated using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-notes', 'study-notes', false, 10485760, '{application/pdf,image/jpeg,image/png,image/webp,image/gif}')
on conflict (id) do nothing;
update storage.buckets set public = false, file_size_limit = 10485760, allowed_mime_types = '{application/pdf,image/jpeg,image/png,image/webp,image/gif}' where id = 'study-notes';

drop policy if exists study_notes_storage_select on storage.objects;
create policy study_notes_storage_select on storage.objects for select to authenticated using (bucket_id = 'study-notes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists study_notes_storage_insert on storage.objects;
create policy study_notes_storage_insert on storage.objects for insert to authenticated with check (bucket_id = 'study-notes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists study_notes_storage_update on storage.objects;
create policy study_notes_storage_update on storage.objects for update to authenticated using (bucket_id = 'study-notes' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'study-notes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists study_notes_storage_delete on storage.objects;
create policy study_notes_storage_delete on storage.objects for delete to authenticated using (bucket_id = 'study-notes' and (storage.foldername(name))[1] = auth.uid()::text);
