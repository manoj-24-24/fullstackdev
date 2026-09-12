/*
# Fullstack Dev Platform foundation

1. New Tables
- `profiles`: one public profile per authenticated user, with immutable server-controlled role.
- `subjects`: learning subjects such as Frontend, Backend, and Cloud Computing.
- `contributions`: student work submissions and review status.
- `contribution_files`: private files attached to contributions.
- `feedback`: teacher review notes and scores.
- `daily_activity`: per-student activity totals used for progress calculations.
- `notifications`: private user notifications.
- `scoring_rules`: administrator-managed scoring guidance.
- `audit_logs`: administrator-visible record of important actions.

2. Security
- Every table has RLS enabled.
- Student, teacher, and administrator access is enforced with database policies.
- Roles are never writable from the browser; role changes use an admin-only function.
- Private uploads are restricted to the authenticated user's storage folder.

3. Important notes
- New accounts start as `student` regardless of browser-supplied metadata.
- Student-owned contributions default ownership from `auth.uid()`.
- Teacher review fields are not writable by students.
*/

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  username text not null default '',
  avatar text,
  bio text not null default '',
  github_url text,
  linkedin_url text,
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_key on public.profiles (lower(username)) where username <> '';

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  title text not null,
  summary text not null default '',
  description text not null default '',
  code text not null default '',
  github_url text,
  contribution_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending', 'approved', 'needs_improvement')),
  score numeric(5,2) check (score is null or (score >= 0 and score <= 100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contribution_files (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.contributions(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  file_type text not null default 'application/octet-stream',
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.contributions(id) on delete cascade,
  teacher_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  feedback text not null,
  score numeric(5,2) not null check (score >= 0 and score <= 100),
  status text not null check (status in ('approved', 'needs_improvement')),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_activity (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  activity_date date not null default current_date,
  contribution_count integer not null default 0 check (contribution_count >= 0),
  daily_score numeric(7,2) not null default 0 check (daily_score >= 0),
  unique(student_id, activity_date)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'info',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  points integer not null default 0 check (points >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists contributions_student_id_idx on public.contributions(student_id);
create index if not exists contributions_subject_id_idx on public.contributions(subject_id);
create index if not exists contributions_date_idx on public.contributions(contribution_date);
create index if not exists feedback_contribution_id_idx on public.feedback(contribution_id);
create index if not exists notifications_user_id_idx on public.notifications(user_id);
create index if not exists daily_activity_student_date_idx on public.daily_activity(student_id, activity_date);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
create or replace function public.is_teacher_or_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'));
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.is_teacher_or_admin() from public;
grant execute on function public.is_teacher_or_admin() to authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, username, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), coalesce(new.raw_user_meta_data->>'username', ''), 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.set_profile_role(p_profile_id uuid, p_role text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_role not in ('student', 'teacher', 'admin') then raise exception 'Invalid role'; end if;
  update public.profiles set role = p_role, updated_at = now() where id = p_profile_id;
  insert into public.audit_logs(user_id, action, target_id) values (auth.uid(), 'role_updated', p_profile_id);
end;
$$;
revoke execute on function public.set_profile_role(uuid, text) from public;
grant execute on function public.set_profile_role(uuid, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.contributions enable row level security;
alter table public.contribution_files enable row level security;
alter table public.feedback enable row level security;
alter table public.daily_activity enable row level security;
alter table public.notifications enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.audit_logs enable row level security;

revoke update on public.profiles from authenticated;
grant update (full_name, username, avatar, bio, github_url, linkedin_url) on public.profiles to authenticated;

-- Profiles: authenticated users can browse directory-safe profile fields; role changes are function-only.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (auth.uid() = id or public.is_admin()) with check (auth.uid() = id or public.is_admin());
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (auth.uid() = id and role = 'student');
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated using (public.is_admin());

-- Subjects are readable by signed-in users; only administrators manage them.
drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects for select to authenticated using (true);
drop policy if exists subjects_insert on public.subjects;
create policy subjects_insert on public.subjects for insert to authenticated with check (public.is_admin());
drop policy if exists subjects_update on public.subjects;
create policy subjects_update on public.subjects for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists subjects_delete on public.subjects;
create policy subjects_delete on public.subjects for delete to authenticated using (public.is_admin());

-- Contributions are public to signed-in platform users, but only owners can edit/delete and only teachers can review.
drop policy if exists contributions_select on public.contributions;
create policy contributions_select on public.contributions for select to authenticated using (student_id = auth.uid() or public.is_teacher_or_admin());
drop policy if exists contributions_insert on public.contributions;
create policy contributions_insert on public.contributions for insert to authenticated with check (student_id = auth.uid());
drop policy if exists contributions_update on public.contributions;
create policy contributions_update on public.contributions for update to authenticated using (student_id = auth.uid() and status = 'pending') with check (student_id = auth.uid());
drop policy if exists contributions_delete on public.contributions;
create policy contributions_delete on public.contributions for delete to authenticated using (student_id = auth.uid() and status = 'pending');

-- Teachers/admins review; students see feedback attached to their own work.
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select to authenticated using (teacher_id = auth.uid() or exists (select 1 from public.contributions c where c.id = contribution_id and c.student_id = auth.uid()) or public.is_admin());
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert to authenticated with check (public.is_teacher_or_admin() and teacher_id = auth.uid());
drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback for update to authenticated using (teacher_id = auth.uid() or public.is_admin()) with check (teacher_id = auth.uid() or public.is_admin());
drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback for delete to authenticated using (public.is_admin());

-- Files follow the contribution owner.
drop policy if exists files_select on public.contribution_files;
create policy files_select on public.contribution_files for select to authenticated using (exists (select 1 from public.contributions c where c.id = contribution_id and (c.student_id = auth.uid() or public.is_teacher_or_admin())));
drop policy if exists files_insert on public.contribution_files;
create policy files_insert on public.contribution_files for insert to authenticated with check (exists (select 1 from public.contributions c where c.id = contribution_id and c.student_id = auth.uid()));
drop policy if exists files_delete on public.contribution_files;
create policy files_delete on public.contribution_files for delete to authenticated using (exists (select 1 from public.contributions c where c.id = contribution_id and c.student_id = auth.uid()));

-- Private per-user records.
drop policy if exists activity_select on public.daily_activity;
create policy activity_select on public.daily_activity for select to authenticated using (student_id = auth.uid() or public.is_teacher_or_admin());
drop policy if exists activity_insert on public.daily_activity;
create policy activity_insert on public.daily_activity for insert to authenticated with check (student_id = auth.uid());
drop policy if exists activity_update on public.daily_activity;
create policy activity_update on public.daily_activity for update to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists activity_delete on public.daily_activity;
create policy activity_delete on public.daily_activity for delete to authenticated using (student_id = auth.uid());

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated with check (public.is_teacher_or_admin() and user_id <> auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- Admin-only controls.
drop policy if exists rules_select on public.scoring_rules;
create policy rules_select on public.scoring_rules for select to authenticated using (true);
drop policy if exists rules_insert on public.scoring_rules;
create policy rules_insert on public.scoring_rules for insert to authenticated with check (public.is_admin());
drop policy if exists rules_update on public.scoring_rules;
create policy rules_update on public.scoring_rules for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists rules_delete on public.scoring_rules;
create policy rules_delete on public.scoring_rules for delete to authenticated using (public.is_admin());
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (public.is_admin());
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs for insert to authenticated with check (auth.uid() = user_id);

insert into public.subjects (name) values ('Frontend'), ('Backend'), ('Cloud Computing') on conflict (name) do nothing;

insert into storage.buckets (id, name, public) values ('contribution-files', 'contribution-files', false) on conflict (id) do nothing;
drop policy if exists contribution_files_read on storage.objects;
create policy contribution_files_read on storage.objects for select to authenticated using (bucket_id = 'contribution-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists contribution_files_insert on storage.objects;
create policy contribution_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'contribution-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists contribution_files_update on storage.objects;
create policy contribution_files_update on storage.objects for update to authenticated using (bucket_id = 'contribution-files' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'contribution-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists contribution_files_delete on storage.objects;
create policy contribution_files_delete on storage.objects for delete to authenticated using (bucket_id = 'contribution-files' and (storage.foldername(name))[1] = auth.uid()::text);
