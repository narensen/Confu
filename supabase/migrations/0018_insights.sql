-- Insights: first-party product analytics, error reports and user feedback,
-- kept in Confu's own database (no third-party trackers). Browsers write
-- through rate-limited functions; only the owner can read across users, via
-- admin_insights(). Safe to re-run.

-- ---------------------------------------------------------------------------
-- Events: page views, feature use, page speed
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  anon_id     text,                   -- random id kept in the browser (links visits before sign-up)
  name        text not null check (name ~ '^[a-z0-9_.]{2,48}$'),
  path        text,                   -- route with ids replaced, e.g. /session/:id
  props       jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists events_time_idx on public.events (created_at desc);
create index if not exists events_name_time_idx on public.events (name, created_at desc);
create index if not exists events_user_time_idx on public.events (user_id, created_at desc);
create index if not exists events_anon_time_idx on public.events (anon_id, created_at desc);

alter table public.events enable row level security;

-- People can see (and export) their own events; writes go through track_events().
drop policy if exists "read own events" on public.events;
create policy "read own events" on public.events
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Store a batch of events from the browser. Signed-out visitors may only send
-- page views, page speed, and landing/auth events. Returns how many were kept.
create or replace function public.track_events(p_events jsonb, p_anon text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  anon text := case when p_anon ~ '^[A-Za-z0-9_-]{8,64}$' then p_anon end;
  recent int;
  e jsonb;
  kept int := 0;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or (uid is null and anon is null) then
    return 0;
  end if;
  -- At most 600 events per person per 10 minutes.
  select count(*) into recent from public.events
  where created_at > now() - interval '10 minutes'
    and (case when uid is not null then user_id = uid else anon_id = anon end);
  if recent > 600 then
    return 0;
  end if;
  for e in select value from jsonb_array_elements(p_events) limit 50 loop
    continue when coalesce(e ->> 'name', '') !~ '^[a-z0-9_.]{2,48}$';
    continue when uid is null and (e ->> 'name') !~ '^(page|vitals|landing|auth)\.';
    insert into public.events (user_id, anon_id, name, path, props)
    values (
      uid, anon, e ->> 'name', left(e ->> 'path', 300),
      case when jsonb_typeof(e -> 'props') = 'object' and length((e -> 'props')::text) <= 2000 then e -> 'props' else '{}'::jsonb end
    );
    kept := kept + 1;
  end loop;
  return kept;
end;
$$;

revoke all on function public.track_events(jsonb, text) from public;
grant execute on function public.track_events(jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Errors: from browsers and from the server
-- ---------------------------------------------------------------------------

create table if not exists public.app_errors (
  id           bigint generated always as identity primary key,
  user_id      uuid references auth.users (id) on delete set null,
  source       text not null check (source in ('client', 'server')),
  fingerprint  text not null,          -- the same error, however many times it happens
  message      text not null,
  stack        text,
  path         text,
  digest       text,                   -- Next.js error digest (matches server logs)
  user_agent   text,
  created_at   timestamptz not null default now()
);

create index if not exists app_errors_time_idx on public.app_errors (created_at desc);
create index if not exists app_errors_fp_time_idx on public.app_errors (fingerprint, created_at desc);

-- No policies: only report_error() writes and admin_insights() reads.
alter table public.app_errors enable row level security;

create or replace function public.report_error(
  p_source text, p_message text, p_stack text default null, p_path text default null,
  p_digest text default null, p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg text := left(trim(both from coalesce(p_message, '')), 1000);
  fp text;
begin
  if p_source not in ('client', 'server') or msg = '' then
    return;
  end if;
  -- Group by message with ids and numbers blanked out.
  fp := md5(p_source || ':' || regexp_replace(left(msg, 300), '[0-9a-f]{8}-[0-9a-f-]{27}|[0-9]+', '#', 'gi'));
  -- Throttle: 20 copies of one error a minute, 1,000 errors in 10 minutes overall.
  if (select count(*) from public.app_errors where fingerprint = fp and created_at > now() - interval '1 minute') >= 20
     or (select count(*) from public.app_errors where created_at > now() - interval '10 minutes') >= 1000 then
    return;
  end if;
  insert into public.app_errors (user_id, source, fingerprint, message, stack, path, digest, user_agent)
  values (auth.uid(), p_source, fp, msg, left(p_stack, 4000), left(p_path, 300), left(p_digest, 100), left(p_user_agent, 300));
end;
$$;

revoke all on function public.report_error(text, text, text, text, text, text) from public;
grant execute on function public.report_error(text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Feedback: the in-app "Send feedback" box
-- ---------------------------------------------------------------------------

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('bug', 'idea', 'confusing', 'love')),
  message     text not null check (char_length(message) between 1 and 4000),
  path        text check (char_length(path) <= 300),
  user_agent  text check (char_length(user_agent) <= 300),
  status      text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at  timestamptz not null default now()
);

create index if not exists feedback_time_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "send own feedback" on public.feedback;
create policy "send own feedback" on public.feedback
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "read own feedback" on public.feedback;
create policy "read own feedback" on public.feedback
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Users choose what they write, never its status or owner.
revoke insert, update, delete on public.feedback from anon, authenticated;
grant insert (kind, message, path, user_agent) on public.feedback to authenticated;
grant select on public.feedback to authenticated;

-- Owner only: mark feedback as seen or done.
create or replace function public.set_feedback_status(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can triage feedback';
  end if;
  if p_status not in ('new', 'seen', 'done') then
    raise exception 'Unknown status';
  end if;
  update public.feedback set status = p_status where id = p_id;
end;
$$;

revoke all on function public.set_feedback_status(bigint, text) from public, anon;
grant execute on function public.set_feedback_status(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The owner's dashboard: everything in one call
-- ---------------------------------------------------------------------------

create or replace function public.admin_insights(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days int := greatest(1, least(coalesce(p_days, 30), 365));
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  out jsonb;
begin
  if not public.is_owner() then
    raise exception 'Owner only';
  end if;

  -- "activity": one row per (user, day) on which they did something.
  with activity as materialized (
    select distinct user_id, d from (
      select user_id, created_at::date as d from public.messages where role = 'user' and created_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.events where user_id is not null and created_at > now() - interval '150 days'
      union all select user_id, last_reviewed_at::date from public.review_items where last_reviewed_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.exam_attempts where created_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.highlights where created_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.documents where created_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.study_sessions where created_at > now() - interval '150 days'
      union all select user_id, updated_at::date from public.paper_reviews where updated_at > now() - interval '150 days'
    ) a
    where user_id is not null
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', days,

    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'new', (select count(*) from auth.users where created_at > since),
      'pro', (select count(*) from public.profiles where role = 'pro'),
      'dau', (select count(distinct user_id) from activity where d = current_date),
      'wau', (select count(distinct user_id) from activity where d > current_date - 7),
      'mau', (select count(distinct user_id) from activity where d > current_date - 30)
    ),

    -- Sign-ups and active people per day.
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', g.day,
        'signups', (select count(*) from auth.users u where u.created_at::date = g.day),
        'active', (select count(distinct a.user_id) from activity a where a.d = g.day)
      ) order by g.day), '[]'::jsonb)
      from (select generate_series(current_date - (days - 1), current_date, interval '1 day')::date as day) g
    ),

    -- Of the people who signed up in the window, how far each got.
    'funnel', (
      with cohort as (select id from auth.users where created_at > since)
      select jsonb_build_array(
        jsonb_build_object('step', 'Signed up', 'users', (select count(*) from cohort)),
        jsonb_build_object('step', 'Created a session', 'users', (select count(*) from cohort c where exists (select 1 from public.study_sessions s where s.user_id = c.id))),
        jsonb_build_object('step', 'Added material', 'users', (select count(*) from cohort c where exists (select 1 from public.documents d where d.user_id = c.id))),
        jsonb_build_object('step', 'Planned or practised', 'users', (select count(*) from cohort c where
            exists (select 1 from public.study_plans p where p.user_id = c.id)
            or exists (select 1 from public.exam_attempts x where x.user_id = c.id)
            or exists (select 1 from public.paper_reviews r where r.user_id = c.id and r.passes_done > 0))),
        jsonb_build_object('step', 'Asked the tutor', 'users', (select count(*) from cohort c where exists (select 1 from public.messages m where m.user_id = c.id and m.role = 'user'))),
        jsonb_build_object('step', 'Came back another day', 'users', (select count(*) from cohort c where (select count(distinct d) from activity a where a.user_id = c.id) >= 2)),
        jsonb_build_object('step', 'Did a review', 'users', (select count(*) from cohort c where exists (select 1 from public.review_items r where r.user_id = c.id and r.reviews > 0)))
      )
    ),

    -- What people actually used in the window (uses and distinct people).
    'features', (
      select coalesce(jsonb_agg(f order by (f ->> 'users')::int desc, (f ->> 'uses')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('feature', 'Tutor: ' || m.action, 'uses', count(*), 'users', count(distinct m.user_id)) as f
        from public.messages m where m.role = 'user' and m.created_at > since group by m.action
        union all
        select jsonb_build_object('feature', case h.kind when 'region' then 'Captured a figure' else 'Saved a highlight' end, 'uses', count(*), 'users', count(distinct h.user_id))
        from public.highlights h where h.created_at > since group by h.kind
        union all
        select jsonb_build_object('feature', 'Answered exam questions', 'uses', count(*), 'users', count(distinct x.user_id))
        from public.exam_attempts x where x.created_at > since having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Reviewed (spaced review)', 'uses', count(*), 'users', count(distinct r.user_id))
        from public.review_items r where r.last_reviewed_at > since having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Built a plan', 'uses', count(*), 'users', count(distinct p.user_id))
        from public.study_plans p where p.created_at > since having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Worked on a paper pass', 'uses', count(*), 'users', count(distinct r.user_id))
        from public.paper_reviews r where r.updated_at > since and r.passes_done > 0 having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Added a PDF', 'uses', count(*), 'users', count(distinct d.user_id))
        from public.documents d where d.created_at > since and d.storage_path is not null having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Added a paper by ID/DOI', 'uses', count(*), 'users', count(distinct d.user_id))
        from public.documents d where d.created_at > since and d.source_url is not null having count(*) > 0
        union all
        select jsonb_build_object('feature', 'UI: ' || e.name, 'uses', count(*), 'users', count(distinct coalesce(e.user_id::text, e.anon_id)))
        from public.events e where e.created_at > since and e.name !~ '^(page|vitals)\.' group by e.name
      ) s
    ),

    -- Session types people create.
    'session_kinds', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (select kind, count(*) as n from public.study_sessions where created_at > since group by kind) k
    ),

    -- Most visited pages, and unique visitors.
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'views', views, 'visitors', visitors) order by views desc), '[]'::jsonb)
      from (
        select path, count(*) as views, count(distinct coalesce(user_id::text, anon_id)) as visitors
        from public.events where name = 'page.view' and created_at > since and path is not null
        group by path order by count(*) desc limit 15
      ) p
    ),

    -- Landing page visitors who weren't signed in, against sign-ups.
    'landing', jsonb_build_object(
      'visitors', (select count(distinct anon_id) from public.events where name = 'page.view' and path = '/' and user_id is null and created_at > since),
      'signups', (select count(*) from auth.users where created_at > since)
    ),

    -- Page speed: 75th percentile per metric, and how often it was poor.
    'vitals', (
      select coalesce(jsonb_agg(jsonb_build_object('metric', upper(substr(name, 8)), 'p75', p75, 'samples', n, 'poor', poor) order by name), '[]'::jsonb)
      from (
        select name,
               round((percentile_cont(0.75) within group (order by (props ->> 'value')::float8))::numeric, 3) as p75,
               count(*) as n,
               count(*) filter (where props ->> 'rating' = 'poor') as poor
        from public.events
        where name like 'vitals.%' and created_at > since and (props ->> 'value') ~ '^[0-9.]+$'
        group by name
      ) v
    ),

    -- Slowest interactions by page (INP), to find buttons like a slow Delete.
    'slow_pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'p75', p75, 'samples', n) order by p75 desc), '[]'::jsonb)
      from (
        select path, round((percentile_cont(0.75) within group (order by (props ->> 'value')::float8))::numeric) as p75, count(*) as n
        from public.events
        where name = 'vitals.inp' and created_at > since and (props ->> 'value') ~ '^[0-9.]+$' and path is not null
        group by path having count(*) >= 3 order by 2 desc limit 8
      ) s
    ),

    -- The specific things that were slow to click (tag + class names, never text).
    'slow_targets', (
      select coalesce(jsonb_agg(jsonb_build_object('target', target, 'path', path, 'p75', p75, 'samples', n) order by p75 desc), '[]'::jsonb)
      from (
        select props ->> 'target' as target,
               (array_agg(path order by created_at desc))[1] as path,
               round((percentile_cont(0.75) within group (order by (props ->> 'value')::float8))::numeric) as p75,
               count(*) as n
        from public.events
        where name = 'vitals.inp' and created_at > since and props ->> 'target' is not null and (props ->> 'value') ~ '^[0-9.]+$'
        group by props ->> 'target'
        having max((props ->> 'value')::float8) > 200
        order by 3 desc limit 8
      ) t
    ),

    -- AI usage: on Confu's keys (Pro pool, free trial, server) vs people's own keys.
    'ai', jsonb_build_object(
      'confu_tokens', (select coalesce(sum(total_tokens), 0) from public.ai_usage where created_at > since and key_ref in ('pro', 'trial', 'server')),
      'own_tokens', (select coalesce(sum(total_tokens), 0) from public.ai_usage where created_at > since and key_ref not in ('pro', 'trial', 'server')),
      'requests', (select count(*) from public.ai_usage where created_at > since),
      'by_feature', (
        select coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'requests', n, 'tokens', t) order by t desc), '[]'::jsonb)
        from (select feature, count(*) as n, sum(total_tokens) as t from public.ai_usage where created_at > since group by feature) f
      ),
      'top_users', (
        select coalesce(jsonb_agg(jsonb_build_object('email', email, 'tokens', t) order by t desc), '[]'::jsonb)
        from (
          select u.email::text as email, sum(a.total_tokens) as t
          from public.ai_usage a join auth.users u on u.id = a.user_id
          where a.created_at > since and a.key_ref in ('pro', 'trial', 'server')
          group by u.email order by 2 desc limit 8
        ) t
      )
    ),

    -- What people told us at sign-up (everyone, all time).
    'survey', jsonb_build_object(
      'heard_from', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(heard_from, 'not answered') as k, count(*) as n from public.profiles group by 1) s),
      'occupation', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(occupation, 'not answered') as k, count(*) as n from public.profiles group by 1) s),
      'purpose', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(purpose, 'not answered') as k, count(*) as n from public.profiles group by 1) s)
    ),

    -- Weekly cohorts: of those who joined in a week, the share active 1-4 weeks later.
    'retention', (
      with cohorts as (
        select id, date_trunc('week', created_at)::date as wk from auth.users where created_at > now() - interval '9 weeks'
      ), cells as (
        select c.wk, k, count(*) as size,
               count(*) filter (where exists (
                 select 1 from activity a where a.user_id = c.id and a.d >= c.wk + 7 * k and a.d < c.wk + 7 * (k + 1)
               )) as active
        from cohorts c cross join generate_series(1, 4) k
        group by c.wk, k
      )
      select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'size', size, 'weeks', weeks) order by wk), '[]'::jsonb)
      from (
        select wk, max(size) as size,
               jsonb_agg(case when wk + 7 * k > current_date then null else round(100.0 * active / greatest(size, 1)) end order by k) as weeks
        from cells group by wk
      ) r
    ),

    -- Newest people, with how much they've done.
    'recent_users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'email', u.email, 'joined', u.created_at, 'plan', coalesce(p.role, 'free'),
        'occupation', p.occupation, 'heard_from', p.heard_from,
        'sessions', (select count(*) from public.study_sessions s where s.user_id = u.id),
        'active_days', (select count(*) from activity a where a.user_id = u.id),
        'last_active', (select max(d) from activity a where a.user_id = u.id)
      ) order by u.created_at desc), '[]'::jsonb)
      from (select * from auth.users order by created_at desc limit 40) u
      left join public.profiles p on p.id = u.id
    ),

    'feedback', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'kind', f.kind, 'message', f.message, 'path', f.path, 'status', f.status,
        'created_at', f.created_at, 'email', u.email
      ) order by (f.status = 'new') desc, f.created_at desc), '[]'::jsonb)
      from (select * from public.feedback order by created_at desc limit 100) f
      left join auth.users u on u.id = f.user_id
    ),

    'errors', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'fingerprint', fingerprint, 'source', source, 'message', message, 'path', path,
        'count', n, 'people', people, 'last_seen', last_seen
      ) order by n desc), '[]'::jsonb)
      from (
        select fingerprint, min(source) as source, count(*) as n, count(distinct user_id) as people, max(created_at) as last_seen,
               (array_agg(message order by created_at desc))[1] as message,
               (array_agg(path order by created_at desc))[1] as path
        from public.app_errors where created_at > since
        group by fingerprint order by count(*) desc limit 30
      ) e
    )
  ) into out;

  return out;
end;
$$;

revoke all on function public.admin_insights(int) from public, anon;
grant execute on function public.admin_insights(int) to authenticated;

notify pgrst, 'reload schema';
