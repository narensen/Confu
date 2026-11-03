-- January counts for a section. No names, no scores, no ranking.
-- Safe to re-run. Does not raise when packs.copies is missing: the
-- hand-in counts do not need migration 0024. copies stays null then.
-- Does not query pack_copies.

create table if not exists public.section_wrapped (
  token       text primary key,
  pack_slug   text,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  exam_date   date,
  handins     int not null,
  copies      int,
  hours       int not null default 0,
  topics      jsonb not null default '[]',
  closed      jsonb not null default '[]',
  course_code text,
  created_at  timestamptz not null default now(),
  constraint section_wrapped_token check (token ~ '^[0-9a-f]{32}$'),
  constraint section_wrapped_counts check (handins >= 0 and hours >= 0 and (copies is null or copies >= 0))
);

create unique index if not exists section_wrapped_one
  on public.section_wrapped (owner_id, pack_slug);

alter table public.section_wrapped enable row level security;
revoke all on public.section_wrapped from public, anon, authenticated;

create or replace function public.roll_section_wrapped(p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_exam date;
  v_slug text;
  v_token text;
  v_handins int := 0;
  v_copies int;
  v_hours int := 0;
  v_code text;
  v_topics jsonb := '[]'::jsonb;
  v_closed jsonb := '[]'::jsonb;
  v_last jsonb;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  select s.exam_date into v_exam
  from public.study_sessions s
  where s.id = p_session and s.user_id = me and s.kind = 'exam';
  if v_exam is null or v_exam >= current_date then
    raise exception 'This page is for after the paper.';
  end if;

  if to_regclass('public.packs') is not null then
    begin
      execute 'select slug from public.packs where session_id = $1' into v_slug using p_session;
    exception when undefined_column or undefined_table then
      v_slug := null;
    end;
  end if;

  select w.token into v_token
  from public.section_wrapped w
  where w.owner_id = me and w.pack_slug is not distinct from v_slug
  limit 1;
  if v_token is not null then
    return v_token;
  end if;

  if to_regclass('public.section_handins') is not null and to_regclass('public.section_papers') is not null then
    if v_slug is not null then
      select count(distinct h.user_id) into v_handins
      from public.section_handins h
      join public.section_papers p on p.id = h.paper_id
      where p.pack_slug = v_slug;
    else
      select count(distinct h.user_id) into v_handins
      from public.section_handins h
      join public.section_papers p on p.id = h.paper_id
      where p.session_id = p_session and p.owner_id = me;
    end if;
  end if;

  v_copies := null;
  if to_regclass('public.packs') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'packs' and column_name = 'copies'
  ) then
    begin
      execute 'select copies from public.packs where session_id = $1' into v_copies using p_session;
    exception when others then
      v_copies := null;
    end;
  end if;

  if v_slug is not null and to_regclass('public.library_hours') is not null then
    select count(*) into v_hours
    from public.library_hours h
    where h.pack_slug = v_slug and h.ends_at <= now();
  end if;

  if v_slug is not null and to_regclass('public.miss_maps') is not null then
    select m.topics into v_last
    from public.miss_maps m
    where m.pack_slug = v_slug
    order by m.created_at desc
    limit 1;
    select coalesce(jsonb_agg(t->>'topic'), '[]'::jsonb) into v_topics
    from jsonb_array_elements(coalesce(v_last, '[]'::jsonb)) t;
    select coalesce(jsonb_agg(distinct name), '[]'::jsonb) into v_closed
    from (
      select e->>'topic' as name
      from public.miss_maps m
      cross join lateral jsonb_array_elements(m.topics) e
      where m.pack_slug = v_slug
        and m.created_at < (
          select max(created_at) from public.miss_maps where pack_slug = v_slug
        )
    ) earlier
    where name is not null
      and not exists (
        select 1 from jsonb_array_elements(coalesce(v_last, '[]'::jsonb)) last
        where last->>'topic' = name
      );
  end if;

  if v_slug is not null and to_regclass('public.packs') is not null then
    begin
      execute 'select course_code from public.packs where session_id = $1' into v_code using p_session;
    exception when undefined_column then
      v_code := null;
    end;
  end if;

  v_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  insert into public.section_wrapped (token, pack_slug, owner_id, exam_date, handins, copies, hours, topics, closed, course_code)
  values (v_token, v_slug, me, v_exam, coalesce(v_handins, 0), v_copies, coalesce(v_hours, 0), coalesce(v_topics, '[]'::jsonb), coalesce(v_closed, '[]'::jsonb), v_code);
  return v_token;
end;
$$;

create or replace function public.get_section_wrapped(p_token text)
returns table (
  token text,
  handins int,
  copies int,
  hours int,
  topics jsonb,
  closed jsonb,
  course_code text,
  exam_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.token, w.handins, w.copies, w.hours, w.topics, w.closed, w.course_code, w.exam_date
  from public.section_wrapped w
  where w.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$$;

revoke all on function public.roll_section_wrapped(uuid) from public, anon;
revoke all on function public.get_section_wrapped(text) from public;

grant execute on function public.roll_section_wrapped(uuid) to authenticated;
grant execute on function public.get_section_wrapped(text) to anon, authenticated;

notify pgrst, 'reload schema';
