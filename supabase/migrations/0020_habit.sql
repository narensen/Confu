-- Habit: study streaks and heatmap, email summaries and review reminders,
-- browser push, and a private calendar feed of the study plan. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Study time per day (in the student's own time zone)
-- ---------------------------------------------------------------------------

create table if not exists public.study_days (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day      date not null,
  seconds  int  not null default 0,
  primary key (user_id, day)
);

alter table public.study_days enable row level security;
drop policy if exists "own rows" on public.study_days;
create policy "own rows" on public.study_days for select to authenticated using ((select auth.uid()) = user_id);

-- Reading time now also counts toward the day (replaces the 0019 version).
drop function if exists public.add_page_time(uuid, jsonb);
create or replace function public.add_page_time(p_document uuid, p_pages jsonb, p_tz text default 'UTC')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tz text := case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then p_tz else 'UTC' end;
  e jsonb;
  secs int;
  total int := 0;
begin
  if uid is null or jsonb_typeof(p_pages) is distinct from 'array' then
    return;
  end if;
  if not exists (select 1 from public.documents where id = p_document and user_id = uid) then
    return;
  end if;
  for e in select value from jsonb_array_elements(p_pages) limit 100 loop
    continue when (e ->> 'page') !~ '^[0-9]{1,5}$';
    secs := least(greatest(coalesce((e ->> 'seconds')::int, 0), 0), 600);
    total := total + secs;
    insert into public.page_time (user_id, document_id, page_number, seconds, visits)
    values (uid, p_document, (e ->> 'page')::int, secs, least(greatest(coalesce((e ->> 'visits')::int, 0), 0), 20))
    on conflict (user_id, document_id, page_number) do update
      set seconds = public.page_time.seconds + excluded.seconds,
          visits = public.page_time.visits + excluded.visits,
          updated_at = now();
  end loop;
  if total > 0 then
    insert into public.study_days (user_id, day, seconds)
    values (uid, (now() at time zone tz)::date, least(total, 1800))
    on conflict (user_id, day) do update set seconds = public.study_days.seconds + excluded.seconds;
  end if;
end;
$$;

revoke all on function public.add_page_time(uuid, jsonb, text) from public, anon;
grant execute on function public.add_page_time(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists timezone        text,
  add column if not exists email_digest    boolean not null default true,
  add column if not exists email_reminders boolean not null default true,
  add column if not exists push_reminders  boolean not null default true,
  add column if not exists calendar_token  text;

update public.profiles set calendar_token = md5(gen_random_uuid()::text || clock_timestamp()::text) where calendar_token is null;
alter table public.profiles alter column calendar_token set default md5(gen_random_uuid()::text || clock_timestamp()::text);
create unique index if not exists profiles_calendar_token_idx on public.profiles (calendar_token);

grant update (timezone, email_digest, email_reminders, push_reminders) on public.profiles to authenticated;

-- A new private calendar link (the old one stops working).
create or replace function public.rotate_calendar_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text := md5(gen_random_uuid()::text || clock_timestamp()::text);
begin
  update public.profiles set calendar_token = t where id = auth.uid();
  return t;
end;
$$;
revoke all on function public.rotate_calendar_token() from public, anon;
grant execute on function public.rotate_calendar_token() to authenticated;

-- ---------------------------------------------------------------------------
-- Browser push subscriptions, and a log of emails/pushes sent
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://'),
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own rows" on public.push_subscriptions;
create policy "own rows" on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.notification_log (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users (id) on delete cascade,
  kind     text not null,          -- 'digest' | 'reminder'
  sent_at  timestamptz not null default now()
);
create index if not exists notification_log_user_idx on public.notification_log (user_id, kind, sent_at desc);
alter table public.notification_log enable row level security; -- no policies: the daily job only

-- ---------------------------------------------------------------------------
-- Your study days: time read plus things done, per day in your time zone
-- ---------------------------------------------------------------------------

create or replace function public.my_study_days(p_days int default 140, p_tz text default 'UTC')
returns table (day date, seconds int, actions int)
language sql
stable
security invoker
set search_path = ''
as $$
  with tz as (
    select case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then p_tz else 'UTC' end as name
  ), since as (
    select now() - make_interval(days => least(greatest(p_days, 7), 400)) as at
  ), acts as (
    select (created_at at time zone (select name from tz))::date as d from public.messages where role = 'user' and created_at > (select at from since)
    union all select (created_at at time zone (select name from tz))::date from public.highlights where created_at > (select at from since)
    union all select (created_at at time zone (select name from tz))::date from public.exam_attempts where created_at > (select at from since)
    union all select (last_reviewed_at at time zone (select name from tz))::date from public.review_items where last_reviewed_at > (select at from since)
  ), days as (
    select d, count(*)::int as n from acts group by d
  )
  select coalesce(s.day, a.d) as day, coalesce(s.seconds, 0) as seconds, coalesce(a.n, 0) as actions
  from (select day, seconds from public.study_days where day > ((select at from since) at time zone (select name from tz))::date) s
  full join days a on a.d = s.day
  order by 1;
$$;
grant execute on function public.my_study_days(int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Calendar feed: open topics of every study plan, for a private link
-- ---------------------------------------------------------------------------

create or replace function public.calendar_feed(p_token text)
returns table (topic_id uuid, title text, due_date date, est_minutes int, page_start int, page_end int, session_id uuid, session_title text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.title, t.due_date, t.est_minutes, t.page_start, t.page_end, s.id, s.title, t.status
  from public.profiles p
  join public.study_plans sp on sp.user_id = p.id
  join public.study_sessions s on s.id = sp.session_id
  join public.plan_topics t on t.plan_id = sp.id
  where p_token ~ '^[0-9a-f]{32}$' and p.calendar_token = p_token
  order by t.due_date, t.position
  limit 1000;
$$;
revoke all on function public.calendar_feed(text) from public;
grant execute on function public.calendar_feed(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The daily job (server key only): who gets a reminder or a weekly summary
-- ---------------------------------------------------------------------------

create or replace function public.reminder_batch()
returns table (user_id uuid, email text, name text, due int, email_ok boolean, push_ok boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, p.full_name, d.due::int, p.email_reminders, p.push_reminders
  from (
    select r.user_id, count(*) as due, max(r.last_reviewed_at) as last_review
    from public.review_items r
    where not r.suspended and r.due_at <= now()
    group by r.user_id
    having count(*) >= 3
  ) d
  join auth.users u on u.id = d.user_id
  join public.profiles p on p.id = d.user_id
  where (p.email_reminders or p.push_reminders)
    and (d.last_review is null or d.last_review < now() - interval '36 hours')
    and not exists (select 1 from public.notification_log l where l.user_id = d.user_id and l.kind = 'reminder' and l.sent_at > now() - interval '3 days');
$$;

create or replace function public.digest_batch()
returns table (user_id uuid, email text, name text, minutes int, active_days int, topics_done int, reviews int, due int, sessions jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, p.full_name,
    coalesce((select sum(seconds) from public.study_days sd where sd.user_id = u.id and sd.day > current_date - 7), 0)::int / 60,
    (select count(distinct x.d) from (
       select created_at::date as d from public.messages m where m.user_id = u.id and m.role = 'user' and m.created_at > now() - interval '7 days'
       union select day from public.study_days sd where sd.user_id = u.id and sd.day > current_date - 7 and sd.seconds >= 60
       union select last_reviewed_at::date from public.review_items r where r.user_id = u.id and r.last_reviewed_at > now() - interval '7 days'
     ) x)::int,
    (select count(*) from public.plan_topics t where t.user_id = u.id and t.completed_at > now() - interval '7 days')::int,
    (select count(*) from public.review_items r where r.user_id = u.id and r.last_reviewed_at > now() - interval '7 days')::int,
    (select count(*) from public.review_items r where r.user_id = u.id and not r.suspended and r.due_at <= now() + interval '1 day')::int,
    (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.updated_at desc), '[]'::jsonb)
       from (select id, title, updated_at from public.study_sessions s where s.user_id = u.id order by updated_at desc limit 3) s)
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.email_digest
    and u.email_confirmed_at is not null
    and exists (select 1 from public.study_sessions s where s.user_id = u.id and s.updated_at > now() - interval '30 days')
    and not exists (select 1 from public.notification_log l where l.user_id = u.id and l.kind = 'digest' and l.sent_at > now() - interval '6 days');
$$;

revoke all on function public.reminder_batch() from public, anon, authenticated;
revoke all on function public.digest_batch() from public, anon, authenticated;
grant execute on function public.reminder_batch() to service_role;
grant execute on function public.digest_batch() to service_role;

notify pgrst, 'reload schema';
