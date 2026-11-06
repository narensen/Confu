-- Roles. Everyone starts as NULL (a regular user who must bring their own
-- Groq API key in each study session). Set 'admin' by hand to let an account
-- use the server's key:
--
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
--
-- Safe to re-run.

alter table public.profiles
  add column if not exists role text check (role in ('admin'));

comment on column public.profiles.role is
  'NULL = regular user (supplies their own Groq key per session); ''admin'' = uses the server key. Set manually.';

-- Users must never be able to change their own role. Previously the profile
-- policy allowed every operation on your own row, so lock it down to reading
-- your profile and editing only your name.
drop policy if exists "own profile" on public.profiles;
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "update own name" on public.profiles;

create policy "read own profile" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "update own name" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Profiles are created by the on_auth_user_created trigger; backfill any
-- account that predates it so every user has a row to hold a role.
insert into public.profiles (id, full_name)
select u.id, u.raw_user_meta_data ->> 'full_name'
from auth.users u
on conflict (id) do nothing;

notify pgrst, 'reload schema';
