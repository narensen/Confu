-- Threads, private learning spaces, and the roadmap list.
-- Safe to re-run.
--
-- Threads are questions anyone signed in can ask, and the replies under them.
-- They are not the tutor in a session.
--
-- A learning space is private to people with its link. Members ask questions
-- there. It is not a study room: no shared timer, no voice.
--
-- A roadmap is a study pack (migration 0024) whose plan was shared as a path.
-- This file does not create packs. public_roadmaps reads them when they exist.

-- ---------------------------------------------------------------------------
-- Spaces and posts
-- ---------------------------------------------------------------------------

create table if not exists public.spaces (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  slug       text not null unique,
  name       text not null,
  about      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spaces_slug check (slug ~ '^s-[a-z0-9]{10}$'),
  constraint spaces_name check (char_length(btrim(name)) between 2 and 80),
  constraint spaces_about check (char_length(about) <= 500)
);

create table if not exists public.space_members (
  space_id   uuid not null references public.spaces (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index if not exists space_members_user_idx on public.space_members (user_id);

-- A thread has a title and no parent. A reply has a parent and no title.
-- space_id null is the public feed. A reply always copies its thread's space.
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references auth.users (id) on delete cascade,
  space_id   uuid references public.spaces (id) on delete cascade,
  parent_id  uuid references public.posts (id) on delete cascade,
  title      text,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_shape check (
    (parent_id is null and title is not null and char_length(btrim(title)) between 3 and 160)
    or (parent_id is not null and title is null)
  ),
  constraint posts_body check (char_length(btrim(body)) between 1 and 8000)
);
create index if not exists posts_feed_idx on public.posts (created_at desc) where parent_id is null and space_id is null;
create index if not exists posts_space_idx on public.posts (space_id, created_at desc) where parent_id is null;
create index if not exists posts_parent_idx on public.posts (parent_id, created_at);

-- One row per question, reply, or new space, so a day of posting has a ceiling.
create table if not exists public.community_hits (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists community_hits_user_idx on public.community_hits (user_id, created_at desc);

drop trigger if exists spaces_updated_at on public.spaces;
create trigger spaces_updated_at before update on public.spaces
  for each row execute function public.set_updated_at();

drop trigger if exists posts_updated_at on public.posts;
create trigger posts_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.posts enable row level security;
alter table public.community_hits enable row level security;

revoke all on public.spaces from public, anon, authenticated;
revoke all on public.space_members from public, anon, authenticated;
revoke all on public.posts from public, anon, authenticated;
revoke all on public.community_hits from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not granted)
-- ---------------------------------------------------------------------------

create or replace function public._in_space(p_space uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.space_members where space_id = p_space and user_id = p_user
  );
$$;

-- Raises before inserting when the day is full, so the check itself is kept.
-- Callers that fail after this should return a jsonb error, not raise, or the
-- hit rolls back with the rest of the function.
create or replace function public._community_hit(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hits bigint;
begin
  select count(*) into hits
  from public.community_hits
  where user_id = p_user and created_at > now() - interval '1 day';
  if hits >= 40 then
    raise exception 'You''ve posted a lot today. Try again tomorrow.';
  end if;
  insert into public.community_hits (user_id) values (p_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------

create or replace function public.list_threads(p_space uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  rows jsonb;
begin
  if p_space is not null and not public._in_space(p_space, me) then
    return jsonb_build_object('error', 'Join this space to see its questions.');
  end if;
  select coalesce(jsonb_agg(obj order by created_at desc), '[]'::jsonb) into rows
  from (
    select p.created_at,
      jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'body', case when char_length(p.body) > 280 then left(p.body, 280) || '…' else p.body end,
        'author', public.first_name_of(p.author_id),
        'mine', p.author_id = me,
        'replies', (select count(*)::int from public.posts r where r.parent_id = p.id),
        'created_at', p.created_at
      ) as obj
    from public.posts p
    where p.parent_id is null
      and p.space_id is not distinct from p_space
    order by p.created_at desc
    limit 40
  ) s;
  return jsonb_build_object('threads', rows);
end;
$$;

create or replace function public.get_thread(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  tid uuid;
  author uuid;
  sid uuid;
  title text;
  body text;
  created timestamptz;
  space_slug text;
  space_name text;
  replies jsonb;
begin
  select p.id, p.author_id, p.space_id, p.title, p.body, p.created_at
    into tid, author, sid, title, body, created
  from public.posts p
  where p.id = p_id and p.parent_id is null;
  if not found then
    return jsonb_build_object('error', 'That question is gone.');
  end if;
  if sid is not null and not public._in_space(sid, me) then
    return jsonb_build_object('error', 'Join the space to read this.');
  end if;
  if sid is not null then
    select s.slug, s.name into space_slug, space_name from public.spaces s where s.id = sid;
  end if;
  select coalesce(jsonb_agg(obj order by created_at), '[]'::jsonb) into replies
  from (
    select r.created_at,
      jsonb_build_object(
        'id', r.id,
        'body', r.body,
        'author', public.first_name_of(r.author_id),
        'mine', r.author_id = me,
        'created_at', r.created_at
      ) as obj
    from public.posts r
    where r.parent_id = tid
    order by r.created_at
    limit 200
  ) s;
  return jsonb_build_object(
    'thread', jsonb_build_object(
      'id', tid,
      'title', title,
      'body', body,
      'author', public.first_name_of(author),
      'mine', author = me,
      'created_at', created,
      'space_slug', space_slug,
      'space_name', space_name
    ),
    'replies', replies
  );
end;
$$;

create or replace function public.create_thread(p_title text, p_body text, p_space uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
  new_id uuid;
begin
  if char_length(clean_title) < 3 or char_length(clean_title) > 160 then
    raise exception 'Ask it in one sentence, under 160 characters.';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 8000 then
    raise exception 'Add the question underneath, up to 8,000 characters.';
  end if;
  if p_space is not null and not public._in_space(p_space, me) then
    return jsonb_build_object('error', 'Join this space before asking in it.');
  end if;
  perform public._community_hit(me);
  insert into public.posts (author_id, space_id, title, body)
  values (me, p_space, clean_title, clean_body)
  returning posts.id into new_id;
  if p_space is not null then
    update public.spaces set updated_at = now() where spaces.id = p_space;
  end if;
  return jsonb_build_object('id', new_id);
end;
$$;

create or replace function public.reply_thread(p_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  clean_body text := btrim(coalesce(p_body, ''));
  sid uuid;
  parent uuid;
  new_id uuid;
begin
  if char_length(clean_body) < 1 or char_length(clean_body) > 8000 then
    raise exception 'Write a reply, up to 8,000 characters.';
  end if;
  select p.id, p.space_id into parent, sid
  from public.posts p
  where p.id = p_id and p.parent_id is null;
  if not found then
    return jsonb_build_object('error', 'That question is gone.');
  end if;
  if sid is not null and not public._in_space(sid, me) then
    return jsonb_build_object('error', 'Join the space before replying.');
  end if;
  perform public._community_hit(me);
  insert into public.posts (author_id, space_id, parent_id, title, body)
  values (me, sid, parent, null, clean_body)
  returning posts.id into new_id;
  return jsonb_build_object('id', new_id);
end;
$$;

create or replace function public.delete_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  author uuid;
begin
  select p.author_id into author from public.posts p where p.id = p_id;
  if not found then
    return jsonb_build_object('error', 'That post is already gone.');
  end if;
  if author <> me then
    return jsonb_build_object('error', 'You can only remove your own posts.');
  end if;
  delete from public.posts where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Spaces
-- ---------------------------------------------------------------------------

create or replace function public.my_spaces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  rows jsonb;
begin
  select coalesce(jsonb_agg(obj order by updated_at desc), '[]'::jsonb) into rows
  from (
    select s.updated_at,
      jsonb_build_object(
        'id', s.id,
        'slug', s.slug,
        'name', s.name,
        'about', s.about,
        'mine', s.owner_id = me,
        'members', (select count(*)::int from public.space_members m where m.space_id = s.id),
        'questions', (select count(*)::int from public.posts p where p.space_id = s.id and p.parent_id is null)
      ) as obj
    from public.spaces s
    join public.space_members mem on mem.space_id = s.id and mem.user_id = me
    order by s.updated_at desc
    limit 50
  ) listed;
  return jsonb_build_object('spaces', rows);
end;
$$;

create or replace function public.space_state(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  sid uuid;
  owner uuid;
  name text;
  about text;
  slug text;
  joined boolean;
  members int;
  questions int;
  threads jsonb := '[]'::jsonb;
begin
  if p_slug is null or p_slug !~ '^s-[a-z0-9]{10}$' then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select s.id, s.owner_id, s.name, s.about, s.slug
    into sid, owner, name, about, slug
  from public.spaces s
  where s.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  joined := public._in_space(sid, me);
  select count(*)::int into members from public.space_members m where m.space_id = sid;
  select count(*)::int into questions from public.posts p where p.space_id = sid and p.parent_id is null;
  if joined then
    threads := coalesce(public.list_threads(sid) -> 'threads', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'id', sid,
    'slug', slug,
    'name', name,
    'about', about,
    'mine', owner = me,
    'joined', joined,
    'members', members,
    'questions', questions,
    'threads', threads
  );
end;
$$;

create or replace function public.create_space(p_name text, p_about text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  clean_name text := btrim(coalesce(p_name, ''));
  clean_about text := btrim(coalesce(p_about, ''));
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
  made_slug text;
  sid uuid;
  n int;
  i int;
begin
  if char_length(clean_name) < 2 or char_length(clean_name) > 80 then
    raise exception 'Give the space a short name.';
  end if;
  if char_length(clean_about) > 500 then
    raise exception 'Keep the description under 500 characters.';
  end if;
  perform public._community_hit(me);
  for n in 1..5 loop
    made_slug := 's-';
    for i in 1..10 loop
      made_slug := made_slug || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      insert into public.spaces (owner_id, slug, name, about)
      values (me, made_slug, clean_name, clean_about)
      returning spaces.id into sid;
      exit;
    exception when unique_violation then
      sid := null;
    end;
  end loop;
  if sid is null then
    return jsonb_build_object('error', 'Couldn''t make a link. Try again.');
  end if;
  insert into public.space_members (space_id, user_id) values (sid, me);
  return jsonb_build_object('slug', made_slug, 'name', clean_name);
end;
$$;

create or replace function public.join_space(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  sid uuid;
begin
  if p_slug is null or p_slug !~ '^s-[a-z0-9]{10}$' then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select s.id into sid from public.spaces s where s.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  insert into public.space_members (space_id, user_id) values (sid, me)
  on conflict do nothing;
  return public.space_state(p_slug);
end;
$$;

create or replace function public.leave_space(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  sid uuid;
  owner uuid;
begin
  if p_slug is null or p_slug !~ '^s-[a-z0-9]{10}$' then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select s.id, s.owner_id into sid, owner from public.spaces s where s.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  if owner = me then
    return jsonb_build_object('error', 'You started this space. Delete it if you want it gone.');
  end if;
  delete from public.space_members where space_id = sid and user_id = me;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_space(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  sid uuid;
  owner uuid;
begin
  if p_slug is null or p_slug !~ '^s-[a-z0-9]{10}$' then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select s.id, s.owner_id into sid, owner from public.spaces s where s.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  if owner <> me then
    return jsonb_build_object('error', 'Only the person who started the space can delete it.');
  end if;
  delete from public.spaces where id = sid;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Roadmaps: public packs that were shared as a path. Empty until packs exist.
-- ---------------------------------------------------------------------------

create or replace function public.public_roadmaps(p_limit int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim int := least(greatest(coalesce(p_limit, 24), 1), 60);
  rows jsonb;
begin
  if to_regclass('public.packs') is null then
    return jsonb_build_object('error', 'Roadmaps share a study pack. Run migration 0024, then 0027.');
  end if;
  execute $q$
    select coalesce(jsonb_agg(obj order by updated_at desc), '[]'::jsonb)
    from (
      select updated_at,
        jsonb_build_object(
          'slug', slug,
          'kind', kind,
          'title', title,
          'description', description,
          'author_name', author_name,
          'sources', coalesce(jsonb_array_length(content->'sources'), 0),
          'topics', coalesce(jsonb_array_length(content->'topics'), 0),
          'copies', copies,
          'days', case when (content->'plan'->>'days') ~ '^[0-9]+$' then (content->'plan'->>'days')::int else null end,
          'minutes', case when (content->'plan'->>'minutes_per_day') ~ '^[0-9]+$' then (content->'plan'->>'minutes_per_day')::int else null end,
          'goal', content->'plan'->>'goal_title'
        ) as obj
      from public.packs
      where visibility = 'public'
        and content->>'roadmap' = 'true'
        and jsonb_typeof(content->'plan') = 'object'
      order by updated_at desc nulls last
      limit $1
    ) listed
  $q$ using lim into rows;
  return rows;
exception
  when undefined_table or undefined_column then
    return jsonb_build_object('error', 'Roadmaps share a study pack. Run migration 0024, then 0027.');
end;
$$;

revoke all on function public._in_space(uuid, uuid) from public, anon, authenticated;
revoke all on function public._community_hit(uuid) from public, anon, authenticated;

revoke all on function public.list_threads(uuid) from public, anon;
revoke all on function public.get_thread(uuid) from public, anon;
revoke all on function public.create_thread(text, text, uuid) from public, anon;
revoke all on function public.reply_thread(uuid, text) from public, anon;
revoke all on function public.delete_post(uuid) from public, anon;
revoke all on function public.my_spaces() from public, anon;
revoke all on function public.space_state(text) from public, anon;
revoke all on function public.create_space(text, text) from public, anon;
revoke all on function public.join_space(text) from public, anon;
revoke all on function public.leave_space(text) from public, anon;
revoke all on function public.delete_space(text) from public, anon;
revoke all on function public.public_roadmaps(int) from public;

grant execute on function public.list_threads(uuid) to authenticated;
grant execute on function public.get_thread(uuid) to authenticated;
grant execute on function public.create_thread(text, text, uuid) to authenticated;
grant execute on function public.reply_thread(uuid, text) to authenticated;
grant execute on function public.delete_post(uuid) to authenticated;
grant execute on function public.my_spaces() to authenticated;
grant execute on function public.space_state(text) to authenticated;
grant execute on function public.create_space(text, text) to authenticated;
grant execute on function public.join_space(text) to authenticated;
grant execute on function public.leave_space(text) to authenticated;
grant execute on function public.delete_space(text) to authenticated;
grant execute on function public.public_roadmaps(int) to anon, authenticated;

notify pgrst, 'reload schema';
