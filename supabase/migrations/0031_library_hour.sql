-- One library hour: a calendar event, not a room. Safe to re-run.
-- Does not write calendar_blocks and does not reference rooms.
-- room_slug is a label the rep typed. At most one upcoming hour per pack,
-- checked in the function (now() cannot sit in an index predicate).

create table if not exists public.library_hours (
  token       text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  pack_slug   text,
  course_code text,
  room_slug   text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  place       text not null,
  topic       text not null,
  created_at  timestamptz not null default now(),
  constraint library_hours_token check (token ~ '^[0-9a-f]{32}$'),
  constraint library_hours_span check (ends_at > starts_at and ends_at < starts_at + interval '4 hours'),
  constraint library_hours_text check (char_length(btrim(place)) between 1 and 80 and char_length(btrim(topic)) between 1 and 80),
  constraint library_hours_room check (room_slug is null or char_length(room_slug) between 1 and 80)
);

alter table public.library_hours enable row level security;
revoke all on public.library_hours from public, anon, authenticated;

create or replace function public.create_library_hour(
  p_session uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_place text,
  p_topic text,
  p_room text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_code text;
  v_place text := left(btrim(coalesce(p_place, '')), 80);
  v_topic text := left(btrim(coalesce(p_topic, '')), 80);
  v_room text := nullif(left(btrim(coalesce(p_room, '')), 80), '');
  v_token text;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (select 1 from public.study_sessions s where s.id = p_session and s.user_id = me) then
    raise exception 'That session isn''t yours.';
  end if;
  if to_regclass('public.packs') is null then
    raise exception 'Publish the pack first.';
  end if;
  begin
    execute 'select slug from public.packs where session_id = $1' into v_slug using p_session;
  exception when undefined_table or undefined_column then
    raise exception 'Publish the pack first.';
  end;
  if v_slug is null then
    raise exception 'Publish the pack first.';
  end if;
  if v_place = '' or v_topic = '' then
    raise exception 'A library hour needs a place and a topic.';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts or p_ends >= p_starts + interval '4 hours' then
    raise exception 'A library hour has to be shorter than 4 hours.';
  end if;
  if exists (
    select 1 from public.library_hours h
    where h.pack_slug = v_slug and h.ends_at > now()
  ) then
    raise exception 'This pack already has an upcoming library hour.';
  end if;
  begin
    execute 'select course_code from public.packs where session_id = $1' into v_code using p_session;
  exception when undefined_column then
    v_code := null;
  end;
  v_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  insert into public.library_hours (token, owner_id, pack_slug, course_code, room_slug, starts_at, ends_at, place, topic)
  values (v_token, me, v_slug, v_code, v_room, p_starts, p_ends, v_place, v_topic);
  return v_token;
end;
$$;

create or replace function public.get_library_hour(p_token text)
returns table (
  token text,
  topic text,
  place text,
  starts_at timestamptz,
  ends_at timestamptz,
  course_code text,
  pack_slug text,
  room_slug text
)
language sql
stable
security definer
set search_path = ''
as $$
  select h.token, h.topic, h.place, h.starts_at, h.ends_at, h.course_code, h.pack_slug, h.room_slug
  from public.library_hours h
  where h.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$$;

revoke all on function public.create_library_hour(uuid, timestamptz, timestamptz, text, text, text) from public, anon;
revoke all on function public.get_library_hour(text) from public;

grant execute on function public.create_library_hour(uuid, timestamptz, timestamptz, text, text, text) to authenticated;
grant execute on function public.get_library_hour(text) to anon, authenticated;

notify pgrst, 'reload schema';
