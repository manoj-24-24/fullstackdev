/*
# Seed default administrator account

1. Change
- Creates (or updates) the platform's default administrator account so the
  admin portal can be signed in with:
    Email:    moogle.2416@gmail.com
    Password: Man$vi@code*924
- Ensures the auth user is email-confirmed and its profile carries the
  `admin` role, regardless of how the account was created before.

2. Security
- Runs with migration (database-owner) privileges and only touches the one
  known admin email.
- No client-callable backdoor is introduced; the app's existing role checks
  and RLS policies still apply to every session.

3. Important notes
- Safe to re-run: the account is upserted, and the password is reset to the
  default above if the account already existed with a different password.
*/

-- Create the admin auth user if missing, otherwise reset its password to the default.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_token,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new
)
values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'moogle.2416@gmail.com',
  crypt('Man$vi@code*924', gen_salt('bf')),
  now(),
  '',
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Platform Administrator","username":"admin"}',
  now(),
  now(),
  '',
  '',
  ''
)
on conflict (email) do update
  set encrypted_password = excluded.encrypted_password,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now();

-- Make sure the matching profile exists and is an administrator.
-- (The new-user trigger normally stamps new accounts as `student`; this
--  migration overrides that role at the database level for this account.)
insert into public.profiles (id, full_name, role)
select u.id, 'Platform Administrator', 'admin'
from auth.users u
where u.email = 'moogle.2416@gmail.com'
on conflict (id) do update
  set role = 'admin',
      full_name = 'Platform Administrator',
      username = case
        when exists (select 1 from public.profiles p where lower(p.username) = 'admin' and p.id <> excluded.id)
        then public.profiles.username
        else 'admin'
      end,
      updated_at = now();