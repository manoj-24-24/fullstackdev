/*
# Harden account creation

1. Change
- Replaces the new-user profile trigger so account creation does not fail when a requested username is already in use.
- Keeps the requested username when available and creates a safe unique fallback when it is not.

2. Security
- Every profile still starts with the server-controlled `student` role.
- Username values are normalized before storage.
- The trigger remains SECURITY DEFINER with a fixed search path.

3. Important notes
- Existing profiles and account data are not changed.
- This migration is safe to re-run.
*/

create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requested_username text;
  normalized_username text;
  fallback_username text;
  suffix integer := 0;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data->>'username', '')));
  normalized_username := regexp_replace(requested_username, '[^a-z0-9_]+', '_', 'g');
  normalized_username := trim(both '_' from normalized_username);
  fallback_username := 'user_' || substr(new.id::text, 1, 8);

  if normalized_username = '' then
    normalized_username := fallback_username;
  end if;

  if exists (select 1 from public.profiles where lower(username) = normalized_username) then
    normalized_username := fallback_username;
  end if;

  begin
    insert into public.profiles (id, full_name, username, role)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), normalized_username, 'student')
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, full_name, username, role)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), fallback_username, 'student')
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
