-- Course-link requests (not people) and pack lineage. Safe to re-run.
--
-- A request is one GET of /c/<code> that is not a link-preview bot.
-- It is not a person, not an account, and not the pilot denominator.
-- No IP, no anon id, and no user-agent is stored. The cap is 400 a day.
--
-- lookup_course is migration 0028. If it is missing, the bump does nothing
-- and the redirect still works. my_pack_copy is migration 0024, which is not
-- in this repo. Lineage is skipped when that function is missing.

create table if not exists public.course_requests (
  code     text not null,
  day      date not null,
  requests int not null default 0,
  primary key (code, day),
  constraint course_requests_code check (code ~ '^[a-z0-9]{4,10}$'),
  constraint course_requests_count check (requests between 0 and 400)
);

alter table public.course_requests enable row level security;
revoke all on public.course_requests from public, anon, authenticated;

create table if not exists public.pack_lineage (
  child_slug  text primary key,
  parent_slug text not null,
  created_at  timestamptz not null default now(),
  constraint pack_lineage_slugs check (
    char_length(child_slug) between 1 and 120
    and char_length(parent_slug) between 1 and 120
    and child_slug <> parent_slug
  )
);

alter table public.pack_lineage enable row level security;
revoke all on public.pack_lineage from public, anon, authenticated;

-- Returns nothing. An unknown code and a known code look the same.
create or replace function public.bump_course_request(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_ua text;
  v_slug text;
begin
  if to_regprocedure('public.lookup_course(text)') is null then
    return;
  end if;
  if v_code !~ '^[a-z0-9]{4,10}$' then
    return;
  end if;
  v_ua := coalesce(current_setting('request.headers', true)::json->>'user-agent', '');
  if v_ua ~* 'WhatsApp|facebookexternalhit|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot' then
    return;
  end if;
  execute 'select public.lookup_course($1)' into v_slug using v_code;
  if v_slug is null or btrim(v_slug) = '' then
    return;
  end if;
  insert into public.course_requests (code, day, requests)
  values (v_code, current_date, 1)
  on conflict (code, day) do update
    set requests = public.course_requests.requests + 1
    where public.course_requests.requests < 400;
end;
$$;

-- Last 14 days, for the pack's owner. Null when there is nothing to show.
create or replace function public.course_requests_recent(p_slug text)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_code text;
  n int;
begin
  if me is null or to_regclass('public.packs') is null then
    return null;
  end if;
  begin
    execute
      'select p.course_code
         from public.packs p
         join public.study_sessions s on s.id = p.session_id
        where p.slug = $1 and s.user_id = $2'
      into v_code
      using left(coalesce(p_slug, ''), 120), me;
  exception when undefined_column or undefined_table then
    return null;
  end;
  if v_code is null then
    return null;
  end if;
  select coalesce(sum(r.requests), 0)::int into n
  from public.course_requests r
  where r.code = v_code and r.day >= (current_date - 13);
  return n;
end;
$$;

-- Write child → parent when this session was itself a copy. Skip otherwise.
create or replace function public.note_pack_lineage(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_child text;
  v_parent text;
begin
  if me is null then
    return;
  end if;
  if to_regprocedure('public.my_pack_copy(uuid)') is null or to_regclass('public.packs') is null then
    return;
  end if;
  if not exists (select 1 from public.study_sessions s where s.id = p_session and s.user_id = me) then
    return;
  end if;
  begin
    execute 'select slug from public.packs where session_id = $1' into v_child using p_session;
    execute 'select public.my_pack_copy($1)::text' into v_parent using p_session;
  exception when others then
    return;
  end;
  if v_child is null or v_parent is null or btrim(v_parent) = '' or v_parent = v_child then
    return;
  end if;
  insert into public.pack_lineage (child_slug, parent_slug)
  values (left(v_child, 120), left(v_parent, 120))
  on conflict (child_slug) do update set parent_slug = excluded.parent_slug;
end;
$$;

revoke all on function public.bump_course_request(text) from public;
revoke all on function public.course_requests_recent(text) from public, anon;
revoke all on function public.note_pack_lineage(uuid) from public, anon;

grant execute on function public.bump_course_request(text) to anon, authenticated;
grant execute on function public.course_requests_recent(text) to authenticated;
grant execute on function public.note_pack_lineage(uuid) to authenticated;

notify pgrst, 'reload schema';
