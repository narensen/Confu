-- Subject spaces, and threads that work like a proper Q&A. Safe to re-run.
-- Needs 0026 (friends: _signed_in, first_name_of) and 0027 (threads, spaces).
--
-- Spaces were private and link-only. Now there are two kinds:
--   private  made by anyone, joined with the link (as before)
--   public   a subject (Mathematics, Physics, Law…), run by Confu, open to
--            everyone signed in. Joining one is following it; asking or
--            replying in it joins you.
-- Threads get votes ("helpful"), an accepted answer chosen by the asker,
-- editing, search, and sorting by activity, votes or what's unanswered.

-- ---------------------------------------------------------------------------
-- Spaces: public subjects beside the private ones
-- ---------------------------------------------------------------------------

alter table public.spaces add column if not exists visibility text not null default 'private';
alter table public.spaces add column if not exists icon text not null default '';
alter table public.spaces add column if not exists category text not null default '';
alter table public.spaces add column if not exists sort int not null default 1000;
-- A subject space belongs to no one (Confu runs it).
alter table public.spaces alter column owner_id drop not null;

alter table public.spaces drop constraint if exists spaces_slug;
alter table public.spaces add constraint spaces_slug
  check (slug ~ '^s-[a-z0-9]{10}$' or slug ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$');
alter table public.spaces drop constraint if exists spaces_visibility;
alter table public.spaces add constraint spaces_visibility check (visibility in ('private', 'public'));
alter table public.spaces drop constraint if exists spaces_icon;
alter table public.spaces add constraint spaces_icon check (char_length(icon) <= 8);
alter table public.spaces drop constraint if exists spaces_category;
alter table public.spaces add constraint spaces_category check (char_length(category) <= 40);
-- Only private spaces have an owner; only public ones may have none.
alter table public.spaces drop constraint if exists spaces_owner;
alter table public.spaces add constraint spaces_owner check (owner_id is not null or visibility = 'public');

create index if not exists spaces_public_idx on public.spaces (sort, name) where visibility = 'public';

-- ---------------------------------------------------------------------------
-- Threads: last activity, the accepted answer, votes
-- ---------------------------------------------------------------------------

alter table public.posts add column if not exists activity_at timestamptz not null default now();
alter table public.posts add column if not exists accepted_id uuid references public.posts (id) on delete set null;

-- When a thread last changed: asked, or last replied to. Recomputed on re-run.
update public.posts p
set activity_at = greatest(
  p.created_at,
  coalesce((select max(r.created_at) from public.posts r where r.parent_id = p.id), p.created_at)
)
where p.parent_id is null;

create index if not exists posts_activity_idx on public.posts (activity_at desc) where parent_id is null;
create index if not exists posts_space_activity_idx on public.posts (space_id, activity_at desc) where parent_id is null;

create table if not exists public.post_votes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_votes_user_idx on public.post_votes (user_id);

alter table public.post_votes enable row level security;
revoke all on public.post_votes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not granted)
-- ---------------------------------------------------------------------------

-- Who can read a space's questions: anyone for a public subject, members
-- for a private space. No space (null) is the open feed.
create or replace function public._space_open(p_space uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_space is null
    or exists (select 1 from public.spaces s where s.id = p_space and s.visibility = 'public')
    or public._in_space(p_space, p_user);
$$;

create or replace function public._space_slug_ok(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_slug is not null and (p_slug ~ '^s-[a-z0-9]{10}$' or p_slug ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$');
$$;

create or replace function public._space_json(p_space uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('slug', s.slug, 'name', s.name, 'icon', s.icon, 'visibility', s.visibility)
  from public.spaces s
  where s.id = p_space;
$$;

-- ---------------------------------------------------------------------------
-- Browsing threads: everywhere public, or one space; sorted; searched
-- ---------------------------------------------------------------------------

create or replace function public.browse_threads(
  p_space  text default null,     -- a space's slug; null is everything public
  p_sort   text default 'active', -- active | new | top | unanswered | mine
  p_query  text default null,
  p_limit  int default 30,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  sid uuid;
  v_sort text := lower(btrim(coalesce(p_sort, 'active')));
  q text := nullif(btrim(coalesce(p_query, '')), '');
  pattern text;
  lim int := least(greatest(coalesce(p_limit, 30), 1), 60);
  off int := least(greatest(coalesce(p_offset, 0), 0), 5000);
  rows jsonb;
  total int;
begin
  if v_sort not in ('active', 'new', 'top', 'unanswered', 'mine') then
    v_sort := 'active';
  end if;
  if p_space is not null then
    select s.id into sid from public.spaces s where s.slug = lower(btrim(p_space));
    if not found then
      return jsonb_build_object('error', 'No space with that link.');
    end if;
    if not public._space_open(sid, me) then
      return jsonb_build_object('error', 'Join this space to see its questions.');
    end if;
  end if;
  if q is not null then
    pattern := '%' || replace(replace(replace(left(q, 120), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with listed as (
    select p.id, p.author_id, p.space_id, p.title, p.body, p.created_at, p.activity_at, p.accepted_id,
      (select count(*)::int from public.posts r where r.parent_id = p.id) as reply_count,
      (select count(*)::int from public.post_votes v where v.post_id = p.id) as vote_count
    from public.posts p
    left join public.spaces s on s.id = p.space_id
    where p.parent_id is null
      and case
        when sid is not null then p.space_id = sid
        -- Everywhere: the open feed and public subjects, and for "mine" also
        -- the private spaces you asked in.
        else p.space_id is null
          or s.visibility = 'public'
          or (v_sort = 'mine' and public._in_space(p.space_id, me))
      end
      and (v_sort <> 'mine' or p.author_id = me)
      and (pattern is null or p.title ilike pattern or p.body ilike pattern)
  ),
  filtered as (
    select * from listed where v_sort <> 'unanswered' or (reply_count = 0 and accepted_id is null)
  ),
  page as (
    select f.*, count(*) over () as full_count
    from filtered f
    order by
      case when v_sort = 'top' then f.vote_count end desc nulls last,
      case when v_sort in ('new', 'unanswered') then f.created_at end desc nulls last,
      f.activity_at desc,
      f.id
    limit lim offset off
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'title', page.title,
        'body', case when char_length(page.body) > 280 then left(page.body, 280) || '…' else page.body end,
        'author', public.first_name_of(page.author_id),
        'mine', page.author_id = me,
        'replies', page.reply_count,
        'votes', page.vote_count,
        'voted', exists (select 1 from public.post_votes v where v.post_id = page.id and v.user_id = me),
        'solved', page.accepted_id is not null,
        'created_at', page.created_at,
        'activity_at', page.activity_at,
        'space', case when page.space_id is null then null else public._space_json(page.space_id) end
      )
      order by
        case when v_sort = 'top' then page.vote_count end desc nulls last,
        case when v_sort in ('new', 'unanswered') then page.created_at end desc nulls last,
        page.activity_at desc,
        page.id
    ), '[]'::jsonb),
    coalesce(max(page.full_count), 0)::int
  into rows, total
  from page;

  return jsonb_build_object('threads', rows, 'total', total);
end;
$$;

-- One thread with its replies, votes and accepted answer.
create or replace function public.get_thread(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  t public.posts;
  space jsonb;
  joined boolean := false;
  replies jsonb;
begin
  select * into t from public.posts p where p.id = p_id and p.parent_id is null;
  if not found then
    return jsonb_build_object('error', 'That question is gone.');
  end if;
  if not public._space_open(t.space_id, me) then
    return jsonb_build_object('error', 'Join the space to read this.');
  end if;
  if t.space_id is not null then
    space := public._space_json(t.space_id);
    joined := public._in_space(t.space_id, me);
  end if;

  select coalesce(jsonb_agg(obj order by created_at), '[]'::jsonb) into replies
  from (
    select r.created_at,
      jsonb_build_object(
        'id', r.id,
        'body', r.body,
        'author', public.first_name_of(r.author_id),
        'mine', r.author_id = me,
        'created_at', r.created_at,
        'edited', r.updated_at > r.created_at + interval '1 minute',
        'votes', (select count(*)::int from public.post_votes v where v.post_id = r.id),
        'voted', exists (select 1 from public.post_votes v where v.post_id = r.id and v.user_id = me),
        'accepted', r.id = t.accepted_id
      ) as obj
    from public.posts r
    where r.parent_id = t.id
    order by r.created_at
    limit 300
  ) listed;

  return jsonb_build_object(
    'thread', jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'body', t.body,
      'author', public.first_name_of(t.author_id),
      'mine', t.author_id = me,
      'created_at', t.created_at,
      'activity_at', t.activity_at,
      'edited', t.updated_at > t.created_at + interval '1 minute',
      'votes', (select count(*)::int from public.post_votes v where v.post_id = t.id),
      'voted', exists (select 1 from public.post_votes v where v.post_id = t.id and v.user_id = me),
      'solved', t.accepted_id is not null,
      'space', space,
      'joined', joined,
      -- As before, for older pages.
      'space_slug', space ->> 'slug',
      'space_name', space ->> 'name'
    ),
    'replies', replies
  );
end;
$$;

-- Asking: in the open feed, a public subject (which joins you), or a
-- private space you're in.
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
  vis text;
  new_id uuid;
begin
  if char_length(clean_title) < 3 or char_length(clean_title) > 160 then
    raise exception 'Ask it in one sentence, under 160 characters.';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 8000 then
    raise exception 'Add the question underneath, up to 8,000 characters.';
  end if;
  if p_space is not null then
    select s.visibility into vis from public.spaces s where s.id = p_space;
    if not found then
      return jsonb_build_object('error', 'That space is gone.');
    end if;
    if vis = 'public' then
      insert into public.space_members (space_id, user_id) values (p_space, me) on conflict do nothing;
    elsif not public._in_space(p_space, me) then
      return jsonb_build_object('error', 'Join this space before asking in it.');
    end if;
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
  vis text;
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
  if sid is not null then
    select s.visibility into vis from public.spaces s where s.id = sid;
    if vis = 'public' then
      insert into public.space_members (space_id, user_id) values (sid, me) on conflict do nothing;
    elsif not public._in_space(sid, me) then
      return jsonb_build_object('error', 'Join the space before replying.');
    end if;
  end if;
  perform public._community_hit(me);
  insert into public.posts (author_id, space_id, parent_id, title, body)
  values (me, sid, parent, null, clean_body)
  returning posts.id into new_id;
  update public.posts set activity_at = now() where id = parent;
  return jsonb_build_object('id', new_id);
end;
$$;

-- Fix a typo or add what was missing. Your own posts only.
create or replace function public.edit_post(p_id uuid, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  author uuid;
  parent uuid;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
begin
  select p.author_id, p.parent_id into author, parent from public.posts p where p.id = p_id;
  if not found then
    return jsonb_build_object('error', 'That post is gone.');
  end if;
  if author <> me then
    return jsonb_build_object('error', 'You can only edit your own posts.');
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 8000 then
    raise exception 'Keep it between 1 and 8,000 characters.';
  end if;
  if parent is null then
    if char_length(clean_title) < 3 or char_length(clean_title) > 160 then
      raise exception 'Ask it in one sentence, under 160 characters.';
    end if;
    update public.posts set title = clean_title, body = clean_body where id = p_id;
  else
    update public.posts set body = clean_body where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- The asker marks the reply that answered it (again to unmark; null clears).
create or replace function public.accept_reply(p_thread uuid, p_reply uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  author uuid;
  current_id uuid;
begin
  select p.author_id, p.accepted_id into author, current_id
  from public.posts p
  where p.id = p_thread and p.parent_id is null;
  if not found then
    return jsonb_build_object('error', 'That question is gone.');
  end if;
  if author <> me then
    return jsonb_build_object('error', 'Only the person who asked can choose the answer.');
  end if;
  if p_reply is not null and not exists (select 1 from public.posts r where r.id = p_reply and r.parent_id = p_thread) then
    return jsonb_build_object('error', 'That reply isn''t on this question.');
  end if;
  update public.posts
  set accepted_id = case when p_reply is null or current_id = p_reply then null else p_reply end
  where id = p_thread;
  return jsonb_build_object('accepted', case when p_reply is null or current_id = p_reply then null else p_reply end);
end;
$$;

-- "Helpful": one per person per post, not on your own.
create or replace function public.toggle_vote(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  author uuid;
  sid uuid;
  on_now boolean;
begin
  select p.author_id, p.space_id into author, sid from public.posts p where p.id = p_id;
  if not found then
    return jsonb_build_object('error', 'That post is gone.');
  end if;
  if not public._space_open(sid, me) then
    return jsonb_build_object('error', 'Join the space first.');
  end if;
  if author = me then
    return jsonb_build_object('error', 'You can''t vote on your own post.');
  end if;
  delete from public.post_votes where post_id = p_id and user_id = me;
  if found then
    on_now := false;
  else
    insert into public.post_votes (post_id, user_id) values (p_id, me);
    on_now := true;
  end if;
  return jsonb_build_object(
    'voted', on_now,
    'votes', (select count(*)::int from public.post_votes v where v.post_id = p_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Spaces
-- ---------------------------------------------------------------------------

-- Every public subject, with how busy it is and whether you follow it.
create or replace function public.browse_spaces()
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
  select coalesce(jsonb_agg(obj order by sort, name), '[]'::jsonb) into rows
  from (
    select s.sort, s.name,
      jsonb_build_object(
        'id', s.id,
        'slug', s.slug,
        'name', s.name,
        'about', s.about,
        'icon', s.icon,
        'category', s.category,
        'visibility', s.visibility,
        'official', s.owner_id is null,
        'mine', false,
        'joined', public._in_space(s.id, me),
        'members', (select count(*)::int from public.space_members m where m.space_id = s.id),
        'questions', (select count(*)::int from public.posts p where p.space_id = s.id and p.parent_id is null),
        'this_week', (select count(*)::int from public.posts p where p.space_id = s.id and p.created_at > now() - interval '7 days')
      ) as obj
    from public.spaces s
    where s.visibility = 'public'
  ) listed;
  return jsonb_build_object('spaces', rows);
end;
$$;

-- The spaces you're in: private ones and the subjects you follow.
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
        'icon', s.icon,
        'category', s.category,
        'visibility', s.visibility,
        'official', s.owner_id is null,
        'mine', coalesce(s.owner_id = me, false),
        'joined', true,
        'members', (select count(*)::int from public.space_members m where m.space_id = s.id),
        'questions', (select count(*)::int from public.posts p where p.space_id = s.id and p.parent_id is null)
      ) as obj
    from public.spaces s
    join public.space_members mem on mem.space_id = s.id and mem.user_id = me
    order by s.updated_at desc
    limit 80
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
  s public.spaces;
  joined boolean;
  threads jsonb := '[]'::jsonb;
begin
  if not public._space_slug_ok(p_slug) then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select * into s from public.spaces sp where sp.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  joined := public._in_space(s.id, me);
  if joined then
    threads := coalesce(public.list_threads(s.id) -> 'threads', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'id', s.id,
    'slug', s.slug,
    'name', s.name,
    'about', s.about,
    'icon', s.icon,
    'category', s.category,
    'visibility', s.visibility,
    'official', s.owner_id is null,
    'mine', coalesce(s.owner_id = me, false),
    'joined', joined,
    'members', (select count(*)::int from public.space_members m where m.space_id = s.id),
    'questions', (select count(*)::int from public.posts p where p.space_id = s.id and p.parent_id is null),
    'threads', threads
  );
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
  if not public._space_slug_ok(p_slug) then
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
  if not public._space_slug_ok(p_slug) then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select s.id, s.owner_id into sid, owner from public.spaces s where s.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  if owner is not null and owner = me then
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
  if not public._space_slug_ok(p_slug) then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select s.id, s.owner_id into sid, owner from public.spaces s where s.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  -- A subject space has no owner: no one can delete it from the app.
  if owner is null or owner <> me then
    return jsonb_build_object('error', 'Only the person who started the space can delete it.');
  end if;
  delete from public.spaces where id = sid;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The subjects. Re-running updates their names, descriptions and order;
-- it never touches their questions or members.
-- ---------------------------------------------------------------------------

insert into public.spaces (owner_id, slug, name, about, visibility, icon, category, sort)
values
  -- Science & Maths
  (null, 'mathematics', 'Mathematics', 'Calculus, linear algebra, proofs, discrete maths and everything between.', 'public', '📐', 'Science & Maths', 10),
  (null, 'statistics', 'Statistics & Probability', 'Distributions, inference, hypothesis tests, regression and Bayesian thinking.', 'public', '🎲', 'Science & Maths', 11),
  (null, 'physics', 'Physics', 'Mechanics, electromagnetism, thermodynamics, quantum and relativity, from intuition to derivation.', 'public', '⚛️', 'Science & Maths', 12),
  (null, 'chemistry', 'Chemistry', 'Organic, inorganic and physical chemistry: mechanisms, bonding, equilibria and lab work.', 'public', '🧪', 'Science & Maths', 13),
  (null, 'biology', 'Biology', 'Cells, genetics, evolution, physiology and ecology.', 'public', '🧬', 'Science & Maths', 14),
  (null, 'earth-science', 'Earth & Environmental Science', 'Geology, climate, oceans, ecosystems and sustainability.', 'public', '🌍', 'Science & Maths', 15),
  (null, 'astronomy', 'Astronomy & Space', 'Stars, galaxies, cosmology, planetary science and spaceflight.', 'public', '🔭', 'Science & Maths', 16),
  -- Engineering & Tech
  (null, 'computer-science', 'Computer Science', 'Algorithms, data structures, theory of computation, operating systems and networks.', 'public', '💻', 'Engineering & Tech', 20),
  (null, 'machine-learning', 'AI & Machine Learning', 'Models, training, deep learning, transformers, and reading ML papers.', 'public', '🤖', 'Engineering & Tech', 21),
  (null, 'data-science', 'Data Science & Analytics', 'SQL, pandas, visualisation, experiments and turning data into decisions.', 'public', '📊', 'Engineering & Tech', 22),
  (null, 'software-engineering', 'Programming & Software', 'Languages, debugging, web and app development, design patterns and interviews.', 'public', '🛠️', 'Engineering & Tech', 23),
  (null, 'electrical-engineering', 'Electrical & Electronics', 'Circuits, signals, control, embedded systems and power.', 'public', '⚡', 'Engineering & Tech', 24),
  (null, 'mechanical-engineering', 'Mechanical Engineering', 'Statics, dynamics, fluids, thermodynamics, materials and design.', 'public', '⚙️', 'Engineering & Tech', 25),
  (null, 'civil-engineering', 'Civil Engineering', 'Structures, geotechnics, transport, water and construction.', 'public', '🏗️', 'Engineering & Tech', 26),
  -- Health & Medicine
  (null, 'medicine', 'Medicine', 'Anatomy, physiology, pathology, pharmacology and clinical reasoning. Not medical advice.', 'public', '🩺', 'Health & Medicine', 30),
  (null, 'psychology', 'Psychology & Neuroscience', 'Cognition, behaviour, the brain, research methods and mental health science.', 'public', '🧠', 'Health & Medicine', 31),
  (null, 'public-health', 'Nursing & Public Health', 'Nursing practice, epidemiology, health policy and global health.', 'public', '🏥', 'Health & Medicine', 32),
  -- Business & Society
  (null, 'economics', 'Economics', 'Micro, macro, econometrics, development and game theory.', 'public', '📈', 'Business & Society', 40),
  (null, 'finance', 'Finance & Accounting', 'Corporate finance, markets, valuation, accounting and personal finance.', 'public', '💰', 'Business & Society', 41),
  (null, 'business', 'Business & Management', 'Strategy, marketing, operations, entrepreneurship and case studies.', 'public', '💼', 'Business & Society', 42),
  (null, 'law', 'Law', 'Constitutional, contract, criminal and international law, cases and legal writing. Not legal advice.', 'public', '⚖️', 'Business & Society', 43),
  (null, 'politics', 'Politics & International Relations', 'Political theory, governments, policy and world affairs.', 'public', '🏛️', 'Business & Society', 44),
  (null, 'sociology', 'Sociology & Anthropology', 'Societies, cultures, inequality, and how people live together.', 'public', '👥', 'Business & Society', 45),
  -- Humanities
  (null, 'history', 'History', 'Periods, sources, historiography and how to argue about the past.', 'public', '📜', 'Humanities', 50),
  (null, 'philosophy', 'Philosophy', 'Ethics, logic, epistemology, metaphysics and the history of ideas.', 'public', '🦉', 'Humanities', 51),
  (null, 'literature', 'Literature & Writing', 'Close reading, criticism, essays and creative writing.', 'public', '📚', 'Humanities', 52),
  (null, 'languages', 'Languages & Linguistics', 'Learning languages, grammar, phonetics and how language works.', 'public', '🗣️', 'Humanities', 53),
  -- Arts & Design
  (null, 'design', 'Design & Architecture', 'Visual, product and UX design, architecture and design history.', 'public', '🎨', 'Arts & Design', 60),
  (null, 'music', 'Music', 'Theory, harmony, composition, performance and music history.', 'public', '🎵', 'Arts & Design', 61),
  -- Exams & Skills
  (null, 'exam-prep', 'Entrance & Competitive Exams', 'JEE, NEET, UPSC, CAT, GATE, GRE, GMAT, SAT and the rest: strategy and doubts.', 'public', '🎯', 'Exams & Skills', 70),
  (null, 'research', 'Research & Academic Writing', 'Reading papers, methods, theses, citations and getting published.', 'public', '🔬', 'Exams & Skills', 71),
  (null, 'study-skills', 'Study Skills & Productivity', 'How to learn, remember, plan and stay focused.', 'public', '📝', 'Exams & Skills', 72),
  (null, 'careers', 'Careers & Interviews', 'Internships, applications, CVs, interviews and choosing a path.', 'public', '🧭', 'Exams & Skills', 73)
on conflict (slug) do update set
  name = excluded.name,
  about = excluded.about,
  visibility = 'public',
  icon = excluded.icon,
  category = excluded.category,
  sort = excluded.sort;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public._space_open(uuid, uuid) from public, anon, authenticated;
revoke all on function public._space_json(uuid) from public, anon, authenticated;
revoke all on function public._space_slug_ok(text) from public, anon, authenticated;

revoke all on function public.browse_threads(text, text, text, int, int) from public, anon;
revoke all on function public.edit_post(uuid, text, text) from public, anon;
revoke all on function public.accept_reply(uuid, uuid) from public, anon;
revoke all on function public.toggle_vote(uuid) from public, anon;
revoke all on function public.browse_spaces() from public, anon;
revoke all on function public.get_thread(uuid) from public, anon;
revoke all on function public.create_thread(text, text, uuid) from public, anon;
revoke all on function public.reply_thread(uuid, text) from public, anon;
revoke all on function public.my_spaces() from public, anon;
revoke all on function public.space_state(text) from public, anon;
revoke all on function public.join_space(text) from public, anon;
revoke all on function public.leave_space(text) from public, anon;
revoke all on function public.delete_space(text) from public, anon;

grant execute on function public.browse_threads(text, text, text, int, int) to authenticated;
grant execute on function public.edit_post(uuid, text, text) to authenticated;
grant execute on function public.accept_reply(uuid, uuid) to authenticated;
grant execute on function public.toggle_vote(uuid) to authenticated;
grant execute on function public.browse_spaces() to authenticated;
grant execute on function public.get_thread(uuid) to authenticated;
grant execute on function public.create_thread(text, text, uuid) to authenticated;
grant execute on function public.reply_thread(uuid, text) to authenticated;
grant execute on function public.my_spaces() to authenticated;
grant execute on function public.space_state(text) to authenticated;
grant execute on function public.join_space(text) to authenticated;
grant execute on function public.leave_space(text) to authenticated;
grant execute on function public.delete_space(text) to authenticated;

notify pgrst, 'reload schema';
