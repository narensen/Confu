-- A section miss map from distinct sharing hand-ins. Safe to re-run.
-- Does not read sitting_shares, exam_attempts, or review_items.
-- If packs, pack_copies, or section_handins are missing, or the pack
-- columns are not the ones the app uses, the roll raises and writes nothing.

create table if not exists public.miss_maps (
  token      text primary key,
  pack_slug  text not null,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  exam_date  date,
  users      int not null,
  topics     jsonb not null,
  band       text,
  revise     jsonb not null default '[]',
  created_at timestamptz not null default now(),
  constraint miss_maps_token check (token ~ '^[0-9a-f]{32}$'),
  constraint miss_maps_users check (users >= 8)
);

alter table public.miss_maps enable row level security;
revoke all on public.miss_maps from public, anon, authenticated;

create or replace function public._packs_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.packs') is null
    or to_regclass('public.pack_copies') is null
    or to_regclass('public.section_handins') is null then
    return false;
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'packs'
      and column_name in ('id', 'slug', 'session_id')
  ) < 3 then
    return false;
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'pack_copies'
      and column_name in ('session_id', 'share_progress', 'pack_id')
  ) < 3 then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.roll_miss_map(p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_users int;
  v_exam date;
  v_days int;
  v_band text;
  v_topics jsonb := '[]'::jsonb;
  v_revise jsonb := '[]'::jsonb;
  v_content jsonb;
  v_token text;
  v_topic text;
  v_missed int;
  v_of int;
  v_plan jsonb;
  v_src text;
  v_page int;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not public._packs_ready() then
    raise exception 'Packs are not in this database.';
  end if;
  if not exists (select 1 from public.study_sessions s where s.id = p_session and s.user_id = me) then
    raise exception 'That session isn''t yours.';
  end if;
  select k.slug into v_slug from public.packs k where k.session_id = p_session;
  if v_slug is null then
    raise exception 'Publish the pack first.';
  end if;

  with copiers as (
    select distinct s.user_id
    from public.pack_copies c
    join public.packs k on k.id = c.pack_id
    join public.study_sessions s on s.id = c.session_id
    where k.slug = v_slug
      and c.share_progress is true
  ),
  hands as (
    select h.user_id, h.topics
    from public.section_handins h
    join public.section_papers p on p.id = h.paper_id
    where p.pack_slug = v_slug
      and p.withdrawn_at is null
      and p.questions is not null
      and h.user_id in (select user_id from copiers)
  )
  select count(distinct user_id) into v_users from hands;

  if coalesce(v_users, 0) < 8 then
    raise exception 'Need 8 hand-ins from people who share progress before a miss map.';
  end if;

  v_of := v_users;
  for v_topic, v_missed in
    with copiers as (
      select distinct s.user_id
      from public.pack_copies c
      join public.packs k on k.id = c.pack_id
      join public.study_sessions s on s.id = c.session_id
      where k.slug = v_slug and c.share_progress is true
    ),
    hands as (
      select h.user_id, h.topics
      from public.section_handins h
      join public.section_papers p on p.id = h.paper_id
      where p.pack_slug = v_slug
        and p.withdrawn_at is null
        and p.questions is not null
        and h.user_id in (select user_id from copiers)
    )
    select topic, count(distinct user_id)::int
    from hands, unnest(topics) as topic
    where btrim(topic) <> ''
    group by topic
    having count(distinct user_id) >= 5
    order by count(distinct user_id) desc, topic
    limit 8
  loop
    v_topics := v_topics || jsonb_build_array(jsonb_build_object(
      'topic', left(v_topic, 80),
      'missed', v_missed,
      'of', v_of
    ));
  end loop;

  if jsonb_array_length(v_topics) = 0 then
    raise exception 'No topic was missed by 5 people yet.';
  end if;

  select s.exam_date into v_exam
  from public.packs k
  join public.study_sessions s on s.id = k.session_id
  where k.slug = v_slug;
  if v_exam is not null then
    v_days := v_exam - current_date;
  end if;
  if v_days between 7 and 14 then
    v_band := 'About ten days out, the section is missing these.';
  end if;

  begin
    execute 'select content from public.packs where slug = $1' into v_content using v_slug;
  exception when undefined_column then
    v_content := null;
  end;
  if v_content is not null then
    for v_topic in select value->>'topic' from jsonb_array_elements(v_topics) loop
      exit when jsonb_array_length(v_revise) >= 3;
      v_plan := null;
      v_src := null;
      v_page := null;
      select t into v_plan
      from jsonb_array_elements(coalesce(v_content->'topics', '[]'::jsonb)) t
      where lower(t->>'title') = lower(v_topic)
      limit 1;
      if v_plan is not null and v_plan->>'doc' ~ '^[0-9]+$' then
        v_src := v_content->'sources'->(v_plan->>'doc')::int->>'title';
        if v_plan->>'page_start' ~ '^[0-9]+$' then
          v_page := (v_plan->>'page_start')::int;
        end if;
      end if;
      v_revise := v_revise || jsonb_build_array(jsonb_build_object(
        'topic', v_topic,
        'sourceTitle', v_src,
        'page', v_page
      ));
    end loop;
  end if;

  v_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  insert into public.miss_maps (token, pack_slug, owner_id, exam_date, users, topics, band, revise)
  values (v_token, v_slug, me, v_exam, v_users, v_topics, v_band, v_revise);
  return v_token;
end;
$$;

create or replace function public.get_miss_map(p_token text)
returns table (
  token text,
  users int,
  topics jsonb,
  band text,
  revise jsonb,
  exam_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.token, m.users, m.topics, m.band, m.revise, m.exam_date
  from public.miss_maps m
  where m.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$$;

revoke all on function public._packs_ready() from public, anon, authenticated;
revoke all on function public.roll_miss_map(uuid) from public, anon;
revoke all on function public.get_miss_map(text) from public;

grant execute on function public.roll_miss_map(uuid) to authenticated;
grant execute on function public.get_miss_map(text) to anon, authenticated;

notify pgrst, 'reload schema';
