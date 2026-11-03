-- Friends, and invites into private study rooms. Safe to re-run.
--
-- Voice itself is not stored: browsers connect to each other directly, and
-- this database only remembers that you are in voice so a friend can see it.
--
-- A friend sees your first name and whether you are online. They see which
-- room you are in when it is public, or when it is a private room they were
-- invited to (or already share). Otherwise they only see that it is private.
--
-- "In a room" and invites call room_state from migration 0025. Until that
-- exists, friend requests still work; room presence and invites wait.

alter table public.profiles add column if not exists friend_code text;
create unique index if not exists profiles_friend_code_idx on public.profiles (friend_code);

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint friendships_distinct check (requester_id <> addressee_id),
  constraint friendships_pair unique (requester_id, addressee_id)
);

create unique index if not exists friendships_one_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);

drop trigger if exists friendships_updated_at on public.friendships;
create trigger friendships_updated_at before update on public.friendships
  for each row execute function public.set_updated_at();

-- Written only by set_friend_presence(). Friends read it through my_friends().
create table if not exists public.friend_presence (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  room_slug    text,
  room_name    text,
  room_private boolean not null default false,
  in_voice     boolean not null default false,
  updated_at   timestamptz not null default now()
);

-- A private-room invite shown on the friend's Friends page. The link still
-- works the same way as copying it: this row is the visible card.
create table if not exists public.room_friend_invites (
  id         uuid primary key default gen_random_uuid(),
  room_slug  text not null,
  room_name  text not null,
  from_id    uuid not null references auth.users (id) on delete cascade,
  to_id      uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint room_friend_invites_once unique (room_slug, to_id),
  constraint room_friend_invites_distinct check (from_id <> to_id)
);
create index if not exists room_friend_invites_to_idx on public.room_friend_invites (to_id);

-- Counts lookup attempts so a code or email can't be guessed all day.
create table if not exists public.friend_request_hits (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists friend_request_hits_user_idx on public.friend_request_hits (user_id, created_at desc);

alter table public.friendships enable row level security;
alter table public.friend_presence enable row level security;
alter table public.room_friend_invites enable row level security;
alter table public.friend_request_hits enable row level security;

revoke all on public.friendships from public, anon, authenticated;
revoke all on public.friend_presence from public, anon, authenticated;
revoke all on public.room_friend_invites from public, anon, authenticated;
revoke all on public.friend_request_hits from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not granted to the API)
-- ---------------------------------------------------------------------------

create or replace function public._signed_in()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  return me;
end;
$$;

create or replace function public.first_name_of(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), ''), 'Someone')
  from public.profiles
  where id = p_id
$$;

create or replace function public._ensure_friend_code(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing text;
  code text;
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
  n int;
  i int;
begin
  select friend_code into existing from public.profiles where id = p_user;
  if existing is not null then
    return existing;
  end if;
  for n in 1..8 loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      update public.profiles set friend_code = code
      where id = p_user and friend_code is null;
      if found then
        return code;
      end if;
    exception when unique_violation then
      null;
    end;
    select friend_code into existing from public.profiles where id = p_user;
    if existing is not null then
      return existing;
    end if;
  end loop;
  raise exception 'Could not make a friend code. Try again.';
end;
$$;

-- The room as migration 0025 reports it, or null when that isn't available.
create or replace function public._room_snapshot(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  state jsonb;
begin
  if p_slug is null or p_slug = '' or to_regprocedure('public.room_state(text)') is null then
    return null;
  end if;
  execute 'select to_jsonb(public.room_state($1))' into state using p_slug;
  if state is null or state = 'null'::jsonb or jsonb_typeof(state) <> 'object' then
    return null;
  end if;
  return state;
exception when others then
  return null;
end;
$$;

create or replace function public._in_room(state jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select state is not null and (
    coalesce((state->>'mine')::boolean, false)
    or exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(state->'members') = 'array' then state->'members' else '[]'::jsonb end
      ) m
      where coalesce((m->>'me')::boolean, false)
    )
  )
$$;

create or replace function public._are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))
  )
$$;

-- True when the caller may see this private room's name: they were invited,
-- they invited this friend, or room_state says they are already in it.
create or replace function public._can_see_room(p_slug text, p_private boolean, p_friend uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_slug is null then
    return false;
  end if;
  if not p_private then
    return true;
  end if;
  if exists (
    select 1 from public.room_friend_invites
    where room_slug = p_slug and (
      (to_id = me and from_id = p_friend) or (from_id = me and to_id = p_friend)
    )
  ) then
    return true;
  end if;
  return public._in_room(public._room_snapshot(p_slug));
end;
$$;

-- ---------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------

create or replace function public.request_friend(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  q text := lower(btrim(coalesce(p_query, '')));
  them uuid;
  rec public.friendships;
  hits bigint;
begin
  if length(q) = 0 or length(q) > 200 then
    raise exception 'Enter a friend code or an email.';
  end if;

  delete from public.friend_request_hits
  where user_id = me and created_at < now() - interval '2 days';

  select count(*) into hits
  from public.friend_request_hits
  where user_id = me and created_at > now() - interval '1 day';
  if hits >= 30 then
    raise exception 'Too many friend requests today. Try again tomorrow.';
  end if;
  insert into public.friend_request_hits (user_id) values (me);

  if position('@' in q) > 0 then
    select id into them from auth.users where lower(email) = q limit 1;
  else
    q := regexp_replace(q, '[^a-z0-9]', '', 'g');
    if length(q) < 6 then
      -- Returned, not raised, so the attempt above is kept and counts toward the daily cap.
      return jsonb_build_object('error', 'Enter a friend code or an email.');
    end if;
    select id into them from public.profiles where friend_code = q;
  end if;

  -- These are ordinary answers, not errors: raising would undo the attempt we just stored,
  -- and then a code or email could be tried without limit.
  if them is null then
    return jsonb_build_object('error', 'No one found with that code or email.');
  end if;
  if them = me then
    return jsonb_build_object('error', 'That''s you.');
  end if;

  perform pg_advisory_xact_lock(hashtext(least(me::text, them::text)), hashtext(greatest(me::text, them::text)));

  select * into rec from public.friendships
  where (requester_id = me and addressee_id = them)
     or (requester_id = them and addressee_id = me);

  if found then
    if rec.status = 'accepted' then
      return jsonb_build_object('error', 'You''re already friends.');
    end if;
    if rec.requester_id = them then
      update public.friendships set status = 'accepted' where id = rec.id;
      return jsonb_build_object('name', coalesce(public.first_name_of(them), 'Someone'), 'status', 'accepted');
    end if;
    return jsonb_build_object('error', 'Request already sent.');
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (me, them, 'pending');
  return jsonb_build_object('name', coalesce(public.first_name_of(them), 'Someone'), 'status', 'pending');
end;
$$;

create or replace function public.respond_friend(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  rec public.friendships;
begin
  select * into rec from public.friendships
  where id = p_id and addressee_id = me and status = 'pending';
  if not found then
    raise exception 'That request isn''t waiting on you.';
  end if;
  if p_accept then
    update public.friendships set status = 'accepted' where id = rec.id;
  else
    delete from public.friendships where id = rec.id;
  end if;
end;
$$;

create or replace function public.cancel_friend_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  n int;
begin
  delete from public.friendships
  where id = p_id and requester_id = me and status = 'pending';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'That request is no longer pending.';
  end if;
end;
$$;

create or replace function public.remove_friend(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  n int;
begin
  if p_user_id is null or p_user_id = me then
    raise exception 'No such friend.';
  end if;
  delete from public.friendships
  where status = 'accepted'
    and ((requester_id = me and addressee_id = p_user_id) or (requester_id = p_user_id and addressee_id = me));
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'No such friend.';
  end if;
  delete from public.room_friend_invites
  where (from_id = me and to_id = p_user_id) or (from_id = p_user_id and to_id = me);
end;
$$;

create or replace function public.my_friends()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  code text := public._ensure_friend_code(me);
  incoming jsonb;
  outgoing jsonb;
  invites jsonb;
  friends jsonb := '[]'::jsonb;
  rec record;
  seen timestamptz;
  slug text;
  rname text;
  rprivate boolean;
  voice boolean;
  online boolean;
  visible boolean;
  hidden boolean;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'name', coalesce(public.first_name_of(f.requester_id), 'Someone'),
    'created_at', f.created_at
  ) order by f.created_at desc), '[]'::jsonb)
  into incoming
  from public.friendships f
  where f.addressee_id = me and f.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'name', coalesce(public.first_name_of(f.addressee_id), 'Someone'),
    'created_at', f.created_at
  ) order by f.created_at desc), '[]'::jsonb)
  into outgoing
  from public.friendships f
  where f.requester_id = me and f.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'room_slug', i.room_slug,
    'room_name', i.room_name,
    'from_name', coalesce(public.first_name_of(i.from_id), 'Someone'),
    'created_at', i.created_at
  ) order by i.created_at desc), '[]'::jsonb)
  into invites
  from public.room_friend_invites i
  where i.to_id = me;

  for rec in
    select case when f.requester_id = me then f.addressee_id else f.requester_id end as other_id
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.addressee_id = me)
    limit 200
  loop
    seen := null;
    slug := null;
    rname := null;
    rprivate := false;
    voice := false;
    select updated_at, room_slug, room_name, room_private, in_voice
      into seen, slug, rname, rprivate, voice
    from public.friend_presence
    where user_id = rec.other_id;
    online := seen is not null and seen > now() - interval '90 seconds';
    visible := online and slug is not null and public._can_see_room(slug, coalesce(rprivate, false), rec.other_id);
    hidden := online and slug is not null and not visible;
    friends := friends || jsonb_build_array(jsonb_build_object(
      'user_id', rec.other_id,
      'name', coalesce(public.first_name_of(rec.other_id), 'Someone'),
      'online', online,
      'in_voice', online and coalesce(voice, false),
      'room_hidden', hidden,
      'room_slug', case when visible then slug else null end,
      'room_name', case when visible then rname else null end
    ));
  end loop;

  return jsonb_build_object(
    'code', code,
    'incoming', incoming,
    'outgoing', outgoing,
    'invites', invites,
    'friends', friends
  );
end;
$$;

create or replace function public.friend_notices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    return jsonb_build_object('incoming', 0, 'invites', 0);
  end if;
  return jsonb_build_object(
    'incoming', (select count(*) from public.friendships where addressee_id = me and status = 'pending'),
    'invites', (select count(*) from public.room_friend_invites where to_id = me)
  );
end;
$$;

-- Heartbeat from the header. The room name comes from room_state, not from
-- the browser, so a client can't claim to be in a room it hasn't joined.
create or replace function public.set_friend_presence(p_slug text, p_voice boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  slug text := nullif(btrim(coalesce(p_slug, '')), '');
  state jsonb;
  room_name text;
  room_private boolean := false;
  voice boolean := false;
begin
  if slug is not null and length(slug) <= 80 and slug ~ '^[A-Za-z0-9_-]+$' then
    state := public._room_snapshot(slug);
    if public._in_room(state) then
      room_name := left(coalesce(nullif(btrim(state->>'name'), ''), 'Study room'), 80);
      room_private := coalesce((state->>'is_public')::boolean, true) = false;
      voice := coalesce(p_voice, false) and room_private;
    else
      slug := null;
    end if;
  else
    slug := null;
  end if;

  insert into public.friend_presence (user_id, room_slug, room_name, room_private, in_voice, updated_at)
  values (me, slug, room_name, room_private, voice, now())
  on conflict (user_id) do update set
    room_slug = excluded.room_slug,
    room_name = excluded.room_name,
    room_private = excluded.room_private,
    in_voice = excluded.in_voice,
    updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Invites into a private room
-- ---------------------------------------------------------------------------

create or replace function public._private_room_for_member(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  state jsonb;
begin
  if p_slug is null or length(p_slug) > 80 or p_slug !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'No such room';
  end if;
  if to_regprocedure('public.room_state(text)') is null then
    raise exception 'Study rooms need migration 0025 to be run.';
  end if;
  state := public._room_snapshot(p_slug);
  if state is null then
    raise exception 'That room doesn''t exist any more.';
  end if;
  if coalesce((state->>'is_public')::boolean, true) then
    raise exception 'Friend invites are for private rooms.';
  end if;
  if not public._in_room(state) then
    raise exception 'Join the room before inviting someone.';
  end if;
  return state;
end;
$$;

create or replace function public.invite_friend_to_room(p_slug text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  state jsonb;
  room_name text;
  n int;
begin
  if p_user_id is null or p_user_id = me then
    raise exception 'Pick a friend to invite.';
  end if;
  if not public._are_friends(me, p_user_id) then
    raise exception 'You can only invite friends.';
  end if;
  state := public._private_room_for_member(p_slug);
  room_name := left(coalesce(nullif(btrim(state->>'name'), ''), 'Study room'), 80);

  select count(*) into n from public.room_friend_invites where room_slug = p_slug;
  if n >= 40 and not exists (
    select 1 from public.room_friend_invites where room_slug = p_slug and to_id = p_user_id
  ) then
    raise exception 'This room already has 40 invites.';
  end if;

  insert into public.room_friend_invites (room_slug, room_name, from_id, to_id)
  values (p_slug, room_name, me, p_user_id)
  on conflict on constraint room_friend_invites_once do update set
    from_id = excluded.from_id,
    room_name = excluded.room_name,
    created_at = now();
end;
$$;

create or replace function public.revoke_room_invite(p_slug text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
begin
  perform public._private_room_for_member(p_slug);
  delete from public.room_friend_invites where room_slug = p_slug and to_id = p_user_id;
end;
$$;

create or replace function public.dismiss_room_invite(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
begin
  delete from public.room_friend_invites where id = p_id and to_id = me;
end;
$$;

-- Friends you can invite into this private room, and whether you already have.
create or replace function public.room_friends(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  friends jsonb := '[]'::jsonb;
  rec record;
  seen timestamptz;
  voice boolean;
begin
  perform public._private_room_for_member(p_slug);
  for rec in
    select case when f.requester_id = me then f.addressee_id else f.requester_id end as other_id
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.addressee_id = me)
    order by public.first_name_of(case when f.requester_id = me then f.addressee_id else f.requester_id end)
    limit 200
  loop
    seen := null;
    voice := false;
    select updated_at, in_voice into seen, voice
    from public.friend_presence
    where user_id = rec.other_id;
    friends := friends || jsonb_build_array(jsonb_build_object(
      'user_id', rec.other_id,
      'name', coalesce(public.first_name_of(rec.other_id), 'Someone'),
      'online', seen is not null and seen > now() - interval '90 seconds',
      'in_voice', seen is not null and seen > now() - interval '90 seconds' and coalesce(voice, false),
      'invited', exists (
        select 1 from public.room_friend_invites where room_slug = p_slug and to_id = rec.other_id
      )
    ));
  end loop;
  return jsonb_build_object('friends', friends);
end;
$$;

revoke all on function public._signed_in() from public, anon, authenticated;
revoke all on function public.first_name_of(uuid) from public, anon, authenticated;
revoke all on function public._ensure_friend_code(uuid) from public, anon, authenticated;
revoke all on function public._room_snapshot(text) from public, anon, authenticated;
revoke all on function public._in_room(jsonb) from public, anon, authenticated;
revoke all on function public._are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public._can_see_room(text, boolean, uuid) from public, anon, authenticated;
revoke all on function public._private_room_for_member(text) from public, anon, authenticated;

revoke all on function public.request_friend(text) from public, anon;
revoke all on function public.respond_friend(uuid, boolean) from public, anon;
revoke all on function public.cancel_friend_request(uuid) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.my_friends() from public, anon;
revoke all on function public.friend_notices() from public, anon;
revoke all on function public.set_friend_presence(text, boolean) from public, anon;
revoke all on function public.invite_friend_to_room(text, uuid) from public, anon;
revoke all on function public.revoke_room_invite(text, uuid) from public, anon;
revoke all on function public.dismiss_room_invite(uuid) from public, anon;
revoke all on function public.room_friends(text) from public, anon;

grant execute on function public.request_friend(text) to authenticated;
grant execute on function public.respond_friend(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.friend_notices() to authenticated;
grant execute on function public.set_friend_presence(text, boolean) to authenticated;
grant execute on function public.invite_friend_to_room(text, uuid) to authenticated;
grant execute on function public.revoke_room_invite(text, uuid) to authenticated;
grant execute on function public.dismiss_room_invite(uuid) to authenticated;
grant execute on function public.room_friends(text) to authenticated;

notify pgrst, 'reload schema';
