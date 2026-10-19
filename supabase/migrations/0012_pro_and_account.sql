-- Plans and account management. Safe to re-run.
--
-- Roles (profiles.role; Pro can also be granted from Settings by the owner):
--   NULL    Free: brings their own Groq key
--   'pro'   Pro: runs on Confu's server keys, with a daily fair-use allowance
--   'admin' Owner: Pro without the allowance, plus the setup check in Settings
--
--   update public.profiles set role = 'pro'
--   where id = (select id from auth.users where email = 'student@example.com');

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('pro', 'admin'));

comment on column public.profiles.role is
  'NULL = Free (own Groq key); ''pro'' = Pro (server keys, daily allowance); ''admin'' = owner (Pro, no allowance). Set manually.';

-- Delete your own account. Removes the auth user, which cascades to every
-- table that references it. Stored files are removed through the Storage API
-- first (the app does this before calling).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Pro requests: users ask from Settings, the owner grants or removes Pro
-- there (or by hand, as above). Admins can't be changed from the app.
alter table public.profiles add column if not exists pro_requested_at timestamptz;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.request_pro()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.profiles set pro_requested_at = coalesce(pro_requested_at, now())
  where id = auth.uid() and role is null;
end;
$$;

-- Owner only (empty for everyone else): Pro members and pending requests.
create or replace function public.pro_members()
returns table (id uuid, email text, full_name text, role text, requested_at timestamptz, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email::text, p.full_name, p.role, p.pro_requested_at, u.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_owner() and (p.role = 'pro' or p.pro_requested_at is not null)
  order by p.pro_requested_at desc nulls last, u.email
$$;

-- Owner only: give (pro = true) or remove Pro, by email. Also clears a request.
create or replace function public.set_pro(target_email text, pro boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change plans';
  end if;
  select u.id into target from auth.users u where lower(u.email) = lower(trim(target_email));
  if target is null then
    raise exception 'No Confu account uses that email';
  end if;
  update public.profiles
  set role = case when pro then 'pro' else null end, pro_requested_at = null
  where profiles.id = target and profiles.role is distinct from 'admin';
  if not found then
    raise exception 'That account is an owner; change it in Supabase';
  end if;
end;
$$;

revoke all on function public.is_owner() from public, anon;
revoke all on function public.request_pro() from public, anon;
revoke all on function public.pro_members() from public, anon;
revoke all on function public.set_pro(text, boolean) from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.request_pro() to authenticated;
grant execute on function public.pro_members() to authenticated;
grant execute on function public.set_pro(text, boolean) to authenticated;

-- Lets the app's setup check see which migrations have been run.
create or replace function public.confu_schema_version()
returns int
language sql
immutable
as $$ select 12 $$;

grant execute on function public.confu_schema_version() to authenticated;

notify pgrst, 'reload schema';
